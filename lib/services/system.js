import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {hasSchema, clamp} from '../util.js';

const POWER_IFACE = 'org.gnome.SettingsDaemon.Power.Screen';
const RFKILL_IFACE = 'org.gnome.SettingsDaemon.Rfkill';

// DND, volume (Gvc via shell's mixer), brightness (gsd-power), night light, colour scheme.
export class SystemService {
    constructor() {
        this._cbs = new Set();
        this._ids = [];
        this._mixer = null;
        this._sink = null;
        this._sinkIds = [];
        this._mixerIds = [];
        this._bright = null;
        this._brightId = 0;
        this._rfkill = null;
        this._rfkillId = 0;
        this._caffeineCookie = 0;
        this._mic = false;
        this._blPoll = 0;
        this._blBurstSrc = 0;
        this._blSub = 0;
        this._micPactl = false;
        this._micPoll = 0;
        this._micShellHooked = false;
        this._dead = false;
        this._notif = hasSchema('org.gnome.desktop.notifications') ? new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'}) : null;
        this._color = hasSchema('org.gnome.settings-daemon.plugins.color') ? new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.color'}) : null;
        this._iface = hasSchema('org.gnome.desktop.interface') ? new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}) : null;
    }

    start() {
        if (this._notif)
            this._ids.push([this._notif, this._notif.connect('changed::show-banners', () => this._emit('dnd'))]);
        if (this._color)
            this._ids.push([this._color, this._color.connect('changed::night-light-enabled', () => this._emit('night'))]);
        if (this._iface)
            this._ids.push([this._iface, this._iface.connect('changed::color-scheme', () => this._emit('scheme'))]);
        this._initVolume();
        this._initBrightness();
        this._initRfkill();
    }

    // ---- DND
    get dnd() { return this._notif ? !this._notif.get_boolean('show-banners') : false; }
    setDnd(v) { this._notif?.set_boolean('show-banners', !v); }

    // ---- night light / dark
    get nightAvailable() { return !!this._color; }
    get nightLight() { return this._color ? this._color.get_boolean('night-light-enabled') : false; }
    setNightLight(v) { this._color?.set_boolean('night-light-enabled', v); }
    get dark() { return this._iface ? this._iface.get_string('color-scheme') === 'prefer-dark' : false; }
    setDark(v) { this._iface?.set_string('color-scheme', v ? 'prefer-dark' : 'default'); }

    // ---- volume
    _initVolume() {
        import('resource:///org/gnome/shell/ui/status/volume.js').then(m => {
            if (this._dead)
                return;
            this._mixer = m.getMixerControl();
            this._mixerIds.push(this._mixer.connect('default-sink-changed', () => this._bindSink()));
            for (const sig of ['stream-added', 'stream-removed'])
                this._mixerIds.push(this._mixer.connect(sig, () => this._checkMic()));
            this._checkMic();
            this._bindSink();
        }).catch(e => console.warn(`minie-pill: volume control unavailable: ${e.message}`));
    }

    _bindSink() {
        for (const id of this._sinkIds) {
            try { this._sink.disconnect(id); } catch (_e) { /* gone */ }
        }
        this._sinkIds = [];
        this._sink = this._mixer.get_default_sink();
        if (this._sink) {
            this._sinkIds.push(this._sink.connect('notify::volume', () => this._emit('volume')));
            this._sinkIds.push(this._sink.connect('notify::is-muted', () => this._emit('volume')));
        }
        this._emit('volume');
    }

    // microphone in use: any of (a) Gvc source outputs, (b) GNOME's own mic indicator, (c) pactl poll
    _micGvc() {
        try {
            return this._mixer.get_source_outputs().some(s =>
                !s.is_event_stream && s.application_id !== 'org.gnome.VolumeControl' && s.application_id !== 'org.PulseAudio.pavucontrol');
        } catch (_e) {
            return false;
        }
    }

    _micShell() {
        try {
            const qs = Main.panel.statusArea.quickSettings;
            const ind = qs?._volumeInput;
            if (!ind)
                return false;
            if (!this._micShellHooked) {
                this._micShellHooked = true;
                this._ids.push([ind, ind.connect('notify::visible', () => this._checkMic())]);
            }
            return !!ind.visible;
        } catch (_e) {
            return false;
        }
    }

    _checkMic() {
        const on = this._micGvc() || this._micShell() || this._micPactl;
        if (on !== this._mic) {
            this._mic = on;
            this._emit('mic');
        }
    }

    setMicPolling(on) {
        if (on && !this._micPoll) {
            this._micPoll = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                this._pollPactl();
                return GLib.SOURCE_CONTINUE;
            });
            this._pollPactl();
        } else if (!on && this._micPoll) {
            GLib.Source.remove(this._micPoll);
            this._micPoll = 0;
            this._micPactl = false;
            this._checkMic();
        }
    }

    _pollPactl() {
        let proc;
        try {
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE});
            launcher.setenv('LC_ALL', 'C', true);
            proc = launcher.spawnv(['pactl', 'list', 'source-outputs']);
        } catch (_e) {
            return;
        }
        proc.communicate_utf8_async(null, null, (p, res) => {
            if (this._dead)
                return;
            try {
                const [, out] = p.communicate_utf8_finish(res);
                const blocks = (out ?? '').split(/^Source Output #\d+/m).slice(1);
                this._micPactl = blocks.some(b =>
                    !/Corked: yes/.test(b) && !/media\.name = "Peak detect"/.test(b) &&
                    !/application\.id = "(org\.gnome\.VolumeControl|org\.PulseAudio\.pavucontrol)"/.test(b) &&
                    !/application\.name = "(GNOME Shell|gnome-shell)"/i.test(b));
                this._checkMic();
            } catch (_e) { /* pactl unavailable */ }
        });
    }

    get micActive() { return !!this._mic; }

    get volumeAvailable() { return !!this._sink; }
    get volume() { return this._sink ? clamp(this._sink.volume / this._mixer.get_vol_max_norm(), 0, 1.5) : 0; }
    get muted() { return this._sink ? this._sink.is_muted : false; }

    setVolume(frac) {
        if (!this._sink)
            return;
        frac = clamp(frac, 0, 1);
        this._sink.volume = Math.round(frac * this._mixer.get_vol_max_norm());
        this._sink.push_volume();
        if (frac > 0 && this._sink.is_muted)
            this._sink.change_is_muted(false);
    }

    stepVolume(delta) {
        if (this._sink) {
            this.setVolume(this.volume + delta);
            return;
        }
        // mixer not available: fall back to wpctl / pactl
        const pct = Math.round(Math.abs(delta) * 100);
        const sign = delta >= 0 ? '+' : '-';
        const tryRun = argv => {
            try {
                Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
                return true;
            } catch (_e) {
                return false;
            }
        };
        if (!tryRun(['wpctl', 'set-volume', '-l', '1.0', '@DEFAULT_AUDIO_SINK@', `${pct}%${sign}`]))
            tryRun(['pactl', 'set-sink-volume', '@DEFAULT_SINK@', `${sign}${pct}%`]);
    }
    toggleMute() { this._sink?.change_is_muted(!this._sink.is_muted); }

    // ---- brightness
    // Sources, in order: sysfs backlight (works on every GNOME version, incl. 49+ where gsd-power no longer
    // owns brightness), then gsd-power's D-Bus property. Changes are noticed by a slow poll plus a fast burst
    // whenever Mutter / gsd say something changed.
    _initBrightness() {
        this._blDevs = [];
        this._blValue = null;
        try {
            const base = '/sys/class/backlight';
            const en = Gio.File.new_for_path(base).enumerate_children('standard::name', 0, null);
            let info;
            while ((info = en.next_file(null))) {
                const dir = `${base}/${info.get_name()}`;
                const max = this._readNum(`${dir}/max_brightness`);
                if (!max)
                    continue;
                const dev = {dir, max, value: null};
                dev.value = this._readDev(dev);
                this._blDevs.push(dev);
            }
        } catch (_e) {
            this._blDevs = [];
        }
        if (this._blDevs.length) {
            this._blValue = this._blDevs.find(d => d.value !== null)?.value ?? null;
            this._blPoll = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._blCheck();
                return GLib.SOURCE_CONTINUE;
            });
            this._blSub = Gio.DBus.session.signal_subscribe(null, 'org.freedesktop.DBus.Properties', 'PropertiesChanged',
                '/org/gnome/Mutter/DisplayConfig', null, Gio.DBusSignalFlags.NONE, () => this._blBurst());
        }

        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null,
            'org.gnome.SettingsDaemon.Power', '/org/gnome/SettingsDaemon/Power', POWER_IFACE, null, (_o, res) => {
                if (this._dead)
                    return;
                try {
                    this._bright = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (_e) {
                    return;
                }
                this._brightId = this._bright.connect('g-properties-changed', () => {
                    this._blBurst();
                    this._emit('brightness');
                });
                this._emit('brightness');
            });
    }

    _readNum(path) {
        try {
            const [ok, bytes] = GLib.file_get_contents(path);
            return ok ? parseInt(new TextDecoder().decode(bytes).trim(), 10) : null;
        } catch (_e) {
            return null;
        }
    }

    _readDev(dev) {
        const v = this._readNum(`${dev.dir}/actual_brightness`) ?? this._readNum(`${dev.dir}/brightness`);
        return v === null || Number.isNaN(v) ? null : clamp(v / dev.max, 0, 1);
    }

    // hybrid laptops expose several backlight devices; whichever one moves is the one that matters
    _blCheck() {
        let changed = false;
        for (const dev of this._blDevs) {
            const v = this._readDev(dev);
            if (v === null)
                continue;
            if (dev.value === null || Math.abs(v - dev.value) >= 0.004) {
                const first = dev.value === null;
                dev.value = v;
                if (!first) {
                    this._blValue = v;
                    changed = true;
                }
            }
        }
        if (changed)
            this._emit('brightness');
    }

    _blBurst() {
        if (!this._blDevs?.length)
            return;
        this._blBurstUntil = GLib.get_monotonic_time() + 1.5e6;
        if (this._blBurstSrc)
            return;
        this._blBurstSrc = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._blCheck();
            if (GLib.get_monotonic_time() > this._blBurstUntil || this._dead) {
                this._blBurstSrc = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    get brightnessAvailable() {
        if (this._blValue !== null && this._blValue !== undefined)
            return true;
        const v = this._bright?.get_cached_property('Brightness');
        return !!v && v.unpack() >= 0;
    }

    get brightness() {
        if (this._blValue !== null && this._blValue !== undefined)
            return this._blValue;
        const v = this._bright?.get_cached_property('Brightness');
        return v ? clamp(v.unpack() / 100, 0, 1) : 0;
    }

    setBrightness(frac) {
        if (!this._bright)
            return;
        const pct = Math.round(clamp(frac, 0.01, 1) * 100);
        this._bright.call('org.freedesktop.DBus.Properties.Set',
            new GLib.Variant('(ssv)', [POWER_IFACE, 'Brightness', new GLib.Variant('i', pct)]),
            Gio.DBusCallFlags.NONE, -1, null, null);
    }

    // ---- airplane mode (gsd-rfkill, same switch as GNOME's quick settings)
    _initRfkill() {
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null,
            'org.gnome.SettingsDaemon.Rfkill', '/org/gnome/SettingsDaemon/Rfkill', RFKILL_IFACE, null, (_o, res) => {
                if (this._dead)
                    return;
                try {
                    this._rfkill = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (_e) {
                    return;
                }
                this._rfkillId = this._rfkill.connect('g-properties-changed', () => this._emit('airplane'));
                this._emit('airplane');
            });
    }

    get airplaneAvailable() {
        const v = this._rfkill?.get_cached_property('HasAirplaneMode');
        return !!v && !!v.unpack();
    }

    get airplane() {
        const v = this._rfkill?.get_cached_property('AirplaneMode');
        return !!v && !!v.unpack();
    }

    setAirplane(on) {
        if (!this._rfkill)
            return false;
        this._rfkill.call('org.freedesktop.DBus.Properties.Set',
            new GLib.Variant('(ssv)', [RFKILL_IFACE, 'AirplaneMode', new GLib.Variant('b', on)]),
            Gio.DBusCallFlags.NONE, -1, null, null);
        return true;
    }

    // ---- caffeine: inhibit idle + suspend through the session manager
    get caffeine() { return this._caffeineCookie !== 0; }

    setCaffeine(on) {
        if (on === this.caffeine)
            return;
        const bus = Gio.DBus.session;
        if (on) {
            bus.call('org.gnome.SessionManager', '/org/gnome/SessionManager', 'org.gnome.SessionManager', 'Inhibit',
                new GLib.Variant('(susu)', ['minie-pill', 0, 'Caffeine: keep the system awake', 12]),
                new GLib.VariantType('(u)'), Gio.DBusCallFlags.NONE, -1, null, (c, res) => {
                    try {
                        const [cookie] = c.call_finish(res).deepUnpack();
                        if (this._dead) {
                            this._uninhibit(cookie);
                            return;
                        }
                        this._caffeineCookie = cookie;
                    } catch (e) {
                        console.warn(`minie-pill: caffeine inhibit failed: ${e.message}`);
                    }
                    this._emit('caffeine');
                });
        } else {
            this._uninhibit(this._caffeineCookie);
            this._caffeineCookie = 0;
            this._emit('caffeine');
        }
    }

    _uninhibit(cookie) {
        if (!cookie)
            return;
        Gio.DBus.session.call('org.gnome.SessionManager', '/org/gnome/SessionManager', 'org.gnome.SessionManager',
            'Uninhibit', new GLib.Variant('(u)', [cookie]), null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    onChanged(cb) {
        this._cbs.add(cb);
        return () => this._cbs.delete(cb);
    }

    _emit(what) {
        for (const cb of [...this._cbs])
            cb(what);
    }

    destroy() {
        this._dead = true;
        for (const [o, id] of this._ids) {
            try { o.disconnect(id); } catch (_e) { /* gone */ }
        }
        this._ids = [];
        for (const id of this._sinkIds) {
            try { this._sink.disconnect(id); } catch (_e) { /* gone */ }
        }
        for (const id of this._mixerIds) {
            try { this._mixer.disconnect(id); } catch (_e) { /* gone */ }
        }
        if (this._rfkillId) {
            try { this._rfkill.disconnect(this._rfkillId); } catch (_e) { /* gone */ }
        }
        this._uninhibit(this._caffeineCookie);
        this._caffeineCookie = 0;
        if (this._brightId) {
            try { this._bright.disconnect(this._brightId); } catch (_e) { /* gone */ }
        }
        for (const id of [this._blPoll, this._blBurstSrc, this._micPoll]) {
            if (id)
                GLib.Source.remove(id);
        }
        this._blPoll = this._blBurstSrc = this._micPoll = 0;
        if (this._blSub)
            Gio.DBus.session.signal_unsubscribe(this._blSub);
        this._blSub = 0;
        this._sinkIds = [];
        this._mixerIds = [];
        this._cbs.clear();
    }
}

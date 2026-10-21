import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const BLUEZ = 'org.bluez';
const ICONS = {
    'audio-headset': 'audio-headset-symbolic',
    'audio-headphones': 'audio-headphones-symbolic',
    'audio-card': 'audio-speakers-symbolic',
    'input-keyboard': 'input-keyboard-symbolic',
    'input-mouse': 'input-mouse-symbolic',
    'input-gaming': 'input-gaming-symbolic',
    'input-tablet': 'input-tablet-symbolic',
    'phone': 'phone-symbolic',
    'computer': 'computer-symbolic',
};

export class BluetoothService {
    constructor() {
        this.devices = new Map();
        this.powered = false;
        this.adapterPath = null;
        this._subs = [];
        this._cbs = new Set();
        this._cancel = new Gio.Cancellable();
        this._pollId = 0;
    }

    start() {
        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            this.pollBatteries();
            return GLib.SOURCE_CONTINUE;
        });
        const bus = Gio.DBus.system;
        const sub = (iface, member, cb) => this._subs.push(
            bus.signal_subscribe(null, iface, member, null, null, Gio.DBusSignalFlags.NONE, cb));
        sub('org.freedesktop.DBus.ObjectManager', 'InterfacesAdded', (_c, _s, _p, _i, _sig, params) => {
            const [path, ifaces] = params.recursiveUnpack();
            if (!path.startsWith('/org/bluez'))
                return;
            this._apply(path, ifaces);
            this._emit();
        });
        sub('org.freedesktop.DBus.ObjectManager', 'InterfacesRemoved', (_c, _s, _p, _i, _sig, params) => {
            const [path] = params.recursiveUnpack();
            if (!path.startsWith('/org/bluez'))
                return;
            if (this.devices.delete(path))
                this._emit({type: 'removed'});
        });
        sub('org.freedesktop.DBus.Properties', 'PropertiesChanged', (_c, _s, path, _i, _sig, params) => {
            if (!path.startsWith('/org/bluez'))
                return;
            const [iface, changed] = params.recursiveUnpack();
            this._apply(path, {[iface]: changed});
        });
        bus.call(BLUEZ, '/', 'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects', null,
            new GLib.VariantType('(a{oa{sa{sv}}})'), Gio.DBusCallFlags.NONE, -1, this._cancel, (c, res) => {
                try {
                    const [objs] = c.call_finish(res).recursiveUnpack();
                    for (const [path, ifaces] of Object.entries(objs))
                        this._apply(path, ifaces, true);
                    this._emit();
                    this.pollBatteries();
                } catch (_e) { /* bluez not running */ }
            });
    }

    _dev(path) {
        let d = this.devices.get(path);
        if (!d) {
            d = {path, name: '', icon: '', connected: false, battery: null};
            this.devices.set(path, d);
        }
        return d;
    }

    _apply(path, ifaces, silent = false) {
        const a = ifaces['org.bluez.Adapter1'];
        if (a) {
            this.adapterPath ??= path;
            if ('Powered' in a) {
                this.powered = !!a.Powered;
                if (!silent)
                    this._emit({type: 'power'});
            }
        }
        const d = ifaces['org.bluez.Device1'];
        const b = ifaces['org.bluez.Battery1'];
        if (!d && !b)
            return;
        const dev = this._dev(path);
        let event = null;
        if (d) {
            if ('Alias' in d)
                dev.name = d.Alias;
            else if ('Name' in d && !dev.name)
                dev.name = d.Name;
            if ('Icon' in d)
                dev.icon = d.Icon;
            if ('Connected' in d) {
                const was = dev.connected;
                dev.connected = !!d.Connected;
                if (!silent && was !== dev.connected) {
                    event = {type: dev.connected ? 'connected' : 'disconnected', device: dev};
                    if (dev.connected) {
                        for (const sec of [2, 6, 15])
                            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, sec, () => {
                                if (!this._cancel.is_cancelled())
                                    this.pollBatteries();
                                return GLib.SOURCE_REMOVE;
                            });
                    }
                }
            }
        }
        if (b && 'Percentage' in b)
            dev.battery = Number(b.Percentage);
        if (!silent)
            this._emit(event ?? {type: 'update'});
    }

    connected() {
        return [...this.devices.values()].filter(d => d.connected);
    }

    static iconFor(dev) {
        const n = (dev.name ?? '').toLowerCase();
        if (/buds|airpod|pods|tws|earbud|earphone|ear\b|headphone|headset|wh-|wf-|jabra|bose/.test(n))
            return /headset|jabra/.test(n) ? 'audio-headset-symbolic' : 'audio-headphones-symbolic';
        if (/mouse|mx master|trackpad/.test(n))
            return 'input-mouse-symbolic';
        if (/keyboard|keychron|k380|k780/.test(n))
            return 'input-keyboard-symbolic';
        if (/controller|gamepad|joy-?con|dualsense|dualshock|xbox/.test(n))
            return 'input-gaming-symbolic';
        if (/speaker|soundbar|boom|jbl|charge|flip/.test(n))
            return 'audio-speakers-symbolic';
        return ICONS[dev.icon] ?? 'bluetooth-active-symbolic';
    }

    // earbuds | headphones | mouse | keyboard | gamepad | speaker | phone | generic
    static kindOf(dev) {
        const n = (dev.name ?? '').toLowerCase();
        if (/buds|airpod|pods|tws|earbud|earphone|in-ear|freebuds|\bear\b|\bear \(/.test(n))
            return 'earbuds';
        if (/headphone|headset|\bwh-|\bwf-|over-ear|bose|jabra|\bqc\b|\bnc\b/.test(n))
            return 'headphones';
        if (/mouse|mx master|trackpad|trackball|\bm\d{3}\b/.test(n))
            return 'mouse';
        if (/keyboard|keychron|k380|k780|mx keys|\bkb\b/.test(n))
            return 'keyboard';
        if (/controller|gamepad|joy-?con|dualsense|dualshock|xbox|gamesir/.test(n))
            return 'gamepad';
        if (/speaker|soundbar|boom|jbl|flip|charge|echo|homepod|soundcore/.test(n))
            return 'speaker';
        if (/phone|iphone|galaxy|pixel|redmi|xiaomi|oneplus|realme|oppo|vivo|android/.test(n))
            return 'phone';
        switch (dev.icon) {
        case 'audio-headphones':
        case 'audio-headset': return 'headphones';
        case 'input-mouse': return 'mouse';
        case 'input-keyboard': return 'keyboard';
        case 'input-gaming': return 'gamepad';
        case 'audio-card': return 'speaker';
        case 'phone': return 'phone';
        default: return 'generic';
        }
    }

    static nameOf(dev) {
        return dev.name || 'Bluetooth device';
    }

    // Battery fallback through UPower (BlueZ only reports Battery1 when its experimental mode is on).
    pollBatteries() {
        const wanted = this.connected().filter(d => d.battery === null || d.battery === undefined || d.fromUpower);
        if (!wanted.length)
            return;
        Gio.DBus.system.call('org.freedesktop.UPower', '/org/freedesktop/UPower', 'org.freedesktop.UPower',
            'EnumerateDevices', null, new GLib.VariantType('(ao)'), Gio.DBusCallFlags.NONE, -1, this._cancel,
            (c, res) => {
                let paths;
                try {
                    [paths] = c.call_finish(res).recursiveUnpack();
                } catch (_e) {
                    return;
                }
                for (const path of paths) {
                    Gio.DBus.system.call('org.freedesktop.UPower', path, 'org.freedesktop.DBus.Properties', 'GetAll',
                        new GLib.Variant('(s)', ['org.freedesktop.UPower.Device']), new GLib.VariantType('(a{sv})'),
                        Gio.DBusCallFlags.NONE, -1, this._cancel, (c2, res2) => {
                            try {
                                const [p] = c2.call_finish(res2).recursiveUnpack();
                                this._matchUpower(p);
                            } catch (_e) { /* device vanished */ }
                        });
                }
            });
    }

    _matchUpower(p) {
        if (typeof p.Percentage !== 'number' || p.Percentage <= 0)
            return;
        const native = String(p.NativePath ?? '');
        const serial = String(p.Serial ?? '').toUpperCase().replace(/:/g, '_');
        for (const d of this.connected()) {
            if (d.battery !== null && d.battery !== undefined && !d.fromUpower)
                continue;
            const tail = d.path.split('/').pop();                  // dev_AA_BB_...
            const addr = tail.replace(/^dev_/, '').toUpperCase();
            if (native.includes(tail) || (serial && serial === addr) || (p.Model && p.Model === d.name)) {
                const pct = Math.round(p.Percentage);
                if (d.battery !== pct) {
                    d.battery = pct;
                    d.fromUpower = true;
                    this._emit({type: 'update'});
                }
            }
        }
    }

    setPowered(v) {
        if (!this.adapterPath)
            return;
        Gio.DBus.system.call(BLUEZ, this.adapterPath, 'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', ['org.bluez.Adapter1', 'Powered', new GLib.Variant('b', v)]),
            null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    onChanged(cb) {
        this._cbs.add(cb);
        return () => this._cbs.delete(cb);
    }

    _emit(ev = {type: 'update'}) {
        for (const cb of [...this._cbs])
            cb(ev);
    }

    destroy() {
        if (this._pollId)
            GLib.Source.remove(this._pollId);
        this._pollId = 0;
        this._cancel.cancel();
        for (const id of this._subs)
            Gio.DBus.system.signal_unsubscribe(id);
        this._subs = [];
        this._cbs.clear();
        this.devices.clear();
    }
}

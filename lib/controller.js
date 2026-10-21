import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Bag, newSession, makeIcon, makeLabel} from './util.js';
import {ActivityManager} from './manager.js';
import {Pill} from './pill.js';
import {IslandPanel} from './panel.js';
import {ModalHost} from './modal.js';
import {springParams} from './spring.js';
import {squircleShell} from './squircle.js';
import {
    ClockActivity, MusicActivity, TimerActivity, BluetoothActivity, WifiActivity,
    DndActivity, NotificationActivity, OsdActivity, WorkspaceActivity, WeatherActivity, CatActivity, DownloadActivity, RecordActivity,
} from './activities.js';
import {BluetoothService} from './services/bluetooth.js';
import {MprisService} from './services/mpris.js';
import {NetworkService} from './services/network.js';
import {SystemService} from './services/system.js';
import {ClipboardService} from './services/clipboard.js';
import {ShelfService} from './services/shelf.js';
import {WeatherService} from './services/weather.js';
import {LyricsService} from './services/lyrics.js';
import {TimerService} from './services/timer.js';
import {NotificationService} from './services/notifications.js';
import {DownloadService} from './services/downloads.js';
import {ArtCache} from './services/art.js';
import {BatteryGlyph} from './battery.js';

const APPEARANCE = ['pill-height', 'pill-top-margin', 'width-mode', 'fixed-width', 'font-size',
    'bg-color', 'text-color', 'accent-color', 'border-enabled', 'border-color', 'corner-smoothing',
    'dot-mode', 'dot-position', 'dot-color', 'dot-size', 'dot-offset-x', 'dot-offset-y', 'dot-inset',
    'pill-roundness', 'border-width', 'content-offset-x', 'content-offset-y'];
const WEATHER_KEYS = ['weather-lat', 'weather-lon', 'weather-name', 'weather-units'];
const WEATHER_REFRESH_MS = 30 * 60 * 1000;

function volumeIcon(v, muted) {
    if (muted || v <= 0)
        return 'audio-volume-muted-symbolic';
    if (v < 0.34)
        return 'audio-volume-low-symbolic';
    if (v < 0.67)
        return 'audio-volume-medium-symbolic';
    return 'audio-volume-high-symbolic';
}

export class Controller {
    constructor(ext) {
        this._ext = ext;
    }

    enable() {
        this._s = this._ext.getSettings();
        this._bag = new Bag();
        this._svc = {};
        this._features = {};
        this._session = newSession();
        this._art = new ArtCache(this._session);
        this._art.prune();
        this._m = new ActivityManager();
        this._btSel = null;
        this._osdOrig = null;
        this._lastNativeOsd = 0;
        this._enabledAt = GLib.get_monotonic_time();
        this._lastVol = null;
        this._lastBri = null;
        this._icons = {};
        try {
            this._icons.caffeine = new Gio.FileIcon({file: Gio.File.new_for_path(`${this._ext.path}/icons/caffeine-symbolic.svg`)});
        } catch (_e) {
            this._icons.caffeine = null;
        }

        this._clock = this._m.add(new ClockActivity(this._s));
        this._music = this._m.add(new MusicActivity({settings: this._s, art: this._art}));
        this._timerAct = this._m.add(new TimerActivity(this._service('timer')));
        this._btAct = this._m.add(new BluetoothActivity({
            onPicker: () => this._openBtPicker(),
            deviceIcon: d => this._deviceIcon(d),
        }));
        this._wifiAct = this._m.add(new WifiActivity());
        this._dndAct = this._m.add(new DndActivity());
        this._weatherAct = this._m.add(new WeatherActivity());
        this._catAct = this._m.add(new CatActivity(this._s));
        this._downAct = this._m.add(new DownloadActivity(
            new Gio.FileIcon({file: Gio.File.new_for_path(`${this._ext.path}/icons/download-symbolic.svg`)}),
            path => this._openDownload(path)));
        this._recAct = this._m.add(new RecordActivity(() => Main.screenshotUI?.stopScreencast?.()));
        this._notifAct = this._m.add(new NotificationActivity(this._s, n => this._activateNotification(n)));
        this._osdAct = this._m.add(new OsdActivity());
        this._wsAct = this._m.add(new WorkspaceActivity());

        this._pill = new Pill(this._s, this._m, {
            onClick: a => this._onPillClick(a),
            onVolumeScroll: amount => this._volumeScroll(amount),
            onMiddleClick: a => this._onMiddleClick(a),
        });
        this._panel = new IslandPanel(this._ctx());
        this._picker = new ModalHost(() => springParams(this._s), ms => this._d(ms), null);

        this._pill.enable();
        this._timerWire();
        this._systemWire();
        this._sync();
        this._bag.connect(this._s, 'changed', (_s, key) => this._onSetting(key));
    }

    disable() {
        this._timerUnsub?.();
        this._sysUnsub?.();
        this._panel?.destroy();
        this._picker?.destroy();
        for (const name of Object.keys(this._features))
            this._setFeature(name, false);
        this._pill?.destroy();
        this._m?.destroy();
        this._bag?.clear();
        for (const s of Object.values(this._svc))
            s.destroy?.();
        this._svc = {};
        this._art?.destroy();
        this._panel = this._picker = this._pill = this._m = this._bag = null;
        this._s = null;
    }

    _d(ms) {
        return Math.round(ms * 100 / Math.max(10, this._s.get_int('animation-speed')));
    }

    _ctx() {
        const self = this;
        return {
            settings: this._s,
            ext: this._ext,
            art: this._art,
            music: this._music,
            d: ms => self._d(ms),
            pillTop: () => self._pill.top,
            pillHide: h => self._pill?.setHidden(h),
            pillSize: () => ({width: self._pill.width, height: self._pill.height}),
            icon: name => self._icons[name] ?? 'applications-system-symbolic',
            airplane: {get: () => self._airplaneOn(), set: v => self._setAirplane(v)},
            mpris: () => (self._s.get_boolean('music-enabled') ? self._service('mpris') : null),
            svc: name => {
                try {
                    return self._service(name);
                } catch (e) {
                    console.warn(`minie-pill: service ${name} unavailable: ${e.message}`);
                    return null;
                }
            },
            close: () => self._panel.close(),
        };
    }

    // bundled symbolic icon per device kind (theme independent)
    _deviceIcon(dev) {
        const kind = dev ? BluetoothService.kindOf(dev) : 'generic';
        this._devIcons ??= {};
        if (!(kind in this._devIcons)) {
            const file = Gio.File.new_for_path(`${this._ext.path}/icons/bt-${kind}-symbolic.svg`);
            this._devIcons[kind] = file.query_exists(null) ? new Gio.FileIcon({file}) : 'bluetooth-active-symbolic';
        }
        return this._devIcons[kind];
    }

    // ---------- services (lazy)
    _service(name) {
        if (this._svc[name])
            return this._svc[name];
        let s;
        switch (name) {
        case 'timer': s = new TimerService(); break;
        case 'mpris': s = new MprisService(); break;
        case 'lyrics': s = new LyricsService(this._session); break;
        case 'bluetooth': s = new BluetoothService(); break;
        case 'network': s = new NetworkService(); break;
        case 'system': s = new SystemService(); break;
        case 'clipboard': s = new ClipboardService(this._s); break;
        case 'shelf': s = new ShelfService(this._s); break;
        case 'weather': s = new WeatherService(this._session); break;
        case 'downloads': s = new DownloadService(this._s); break;
        default: throw new Error(`unknown service ${name}`);
        }
        this._svc[name] = s;
        s.start?.();
        return s;
    }

    _dropService(name) {
        const s = this._svc[name];
        if (!s)
            return;
        s.destroy?.();
        delete this._svc[name];
    }

    // ---------- settings
    _onSetting(key) {
        if (APPEARANCE.includes(key)) {
            this._pill.restyle();
            return;
        }
        if (key === 'clock-24h' || key === 'clock-seconds' || key === 'clock-font' || key === 'clock-font-size') {
            this._clock.refresh();
            return;
        }
        if (key === 'lyrics-in-pill') {
            this._music._render();
            return;
        }
        if (key === 'lyrics-enabled') {
            this._lyricsKey = null;
            if (this._features.music)
                this._onMpris();
            return;
        }
        if (key === 'hide-default-banner') {
            this._notifSvc?.applyBannerPolicy();
            return;
        }
        if (WEATHER_KEYS.includes(key)) {
            if (this._features.weather)
                this._fetchWeather(true, true);
            return;
        }
        if (key === 'download-dir' || key === 'download-net-enabled') {
            if (this._features.download) {
                this._setFeature('download', false);
                this._setFeature('download', this._s.get_boolean('download-enabled'));
            }
            return;
        }
        if (key === 'download-net-threshold')
            return;
        if (key === 'cat-trigger') {
            this._runCat(true);
            return;
        }
        if (key.startsWith('cat-')) {
            if (this._features.cat) {
                this._setFeature('cat', false);
                this._setFeature('cat', this._s.get_boolean('cat-enabled'));
            }
            return;
        }
        if (key === 'dot-mode') {
            this._svc.system?.setMicPolling(this._s.get_string('dot-mode') === 'mic');
            this._pill.restyle();
            return;
        }
        if (key === 'status-badges' || key === 'dnd-enabled') {
            this._updateBadges();
            if (key === 'status-badges')
                return;
        }
        if (key.startsWith('notification-') || key.startsWith('spring-') || key === 'panel-width' || key === 'panel-height')
            return;
        this._sync();
    }

    _sync() {
        const s = this._s;
        this._m.setAvailable(this._clock, s.get_boolean('clock-always'));
        this._setFeature('music', s.get_boolean('music-enabled'));
        this._setFeature('bt', s.get_boolean('bt-enabled'));
        this._setFeature('wifi', s.get_boolean('wifi-enabled'));
        this._setFeature('notif', s.get_boolean('notif-enabled'));
        this._setFeature('osd', s.get_boolean('osd-enabled'));
        this._setFeature('ws', s.get_boolean('workspace-enabled'));
        this._setFeature('clip', s.get_boolean('clipboard-enabled'));
        this._setFeature('weather', s.get_boolean('weather-in-pill'));
        this._setFeature('cat', s.get_boolean('cat-enabled'));
        this._setFeature('download', s.get_boolean('download-enabled'));
        this._setFeature('rec', s.get_boolean('record-enabled'));
        this._updateBadges();
        this._pill.refresh();
    }

    _setFeature(name, on) {
        const cur = this._features[name];
        if (!!cur === on)
            return;
        const start = {
            music: () => this._startMusic(), bt: () => this._startBt(), wifi: () => this._startWifi(),
            notif: () => this._startNotif(), osd: () => this._startOsd(), ws: () => this._startWs(),
            clip: () => this._service('clipboard'), weather: () => this._startWeather(),
            cat: () => this._scheduleCat(this._s.get_int('cat-interval') * 1000),
            download: () => this._startDownloads(), rec: () => this._startRecord(),
        };
        const stop = {
            music: () => this._stopMusic(), bt: () => this._stopBt(), wifi: () => this._stopWifi(),
            notif: () => this._stopNotif(), osd: () => this._stopOsd(), ws: () => this._stopWs(),
            clip: () => this._dropService('clipboard'), weather: () => this._stopWeather(),
            cat: () => { this._bag.cancel(this._catTimer); this._catTimer = 0; },
            download: () => this._stopDownloads(), rec: () => this._stopRecord(),
        };
        if (on) {
            this._features[name] = true;
            try {
                start[name]();
            } catch (e) {
                console.warn(`minie-pill: feature ${name} failed: ${e.message}`);
            }
        } else {
            try {
                stop[name]();
            } catch (e) {
                console.warn(`minie-pill: stopping ${name} failed: ${e.message}`);
            }
            delete this._features[name];
        }
    }

    // ---------- timer
    _timerWire() {
        const t = this._service('timer');
        this._timerUnsub = t.onChanged(what => {
            this._m.setAvailable(this._timerAct, t.state !== 'idle');
            if (what === 'finished') {
                this._timerAct.update();
                try {
                    global.display.get_sound_player().play_from_theme('complete', 'Timer finished', null);
                } catch (_e) { /* no sound theme */ }
                this._m.flash(this._timerAct, 6000);
                this._bag.timeout(20000, () => {
                    if (t.state === 'finished')
                        t.reset();
                    return false;
                });
            }
        });
    }

    // ---------- system state: DND / caffeine / airplane badges + OSD fallback
    _systemWire() {
        const sys = this._service('system');
        this._sysUnsub = sys.onChanged(what => this._onSystem(what));
        this._pill.setMicActive(sys.micActive);
        sys.setMicPolling(this._s.get_string('dot-mode') === 'mic');
        this._updateBadges();
    }

    _airplaneOn() {
        const sys = this._svc.system;
        if (sys?.airplaneAvailable)
            return sys.airplane;
        const n = this._svc.network, b = this._svc.bluetooth;
        return !!n && !!b && !n.enabled && !b.powered;
    }

    _setAirplane(on) {
        const sys = this._service('system');
        if (sys.airplaneAvailable && sys.setAirplane(on))
            return;
        // no gsd-rfkill: switch radios individually
        this._service('network').setEnabled(!on);
        this._service('bluetooth').setPowered(!on);
        this._updateBadges();
    }

    _updateBadges() {
        if (!this._pill)
            return;
        const sys = this._svc.system;
        const on = this._s.get_boolean('status-badges') && sys;
        this._pill.setBadge('dnd', on && this._s.get_boolean('dnd-enabled') && sys.dnd ? 'notifications-disabled-symbolic' : null);
        this._pill.setBadge('caffeine', on && sys.caffeine ? (this._icons.caffeine ?? 'view-reveal-symbolic') : null);
        this._pill.setBadge('airplane', on && this._airplaneOn() ? 'airplane-mode-symbolic' : null);
        const dnd = !!sys?.dnd && this._s.get_boolean('dnd-enabled');
        this._dndAct.setOn(dnd);
        this._m.setAvailable(this._dndAct, dnd);
    }

    _onSystem(what) {
        const sys = this._svc.system;
        const dur = this._s.get_int('status-duration');
        const settled = GLib.get_monotonic_time() - this._enabledAt > 3e6;
        switch (what) {
        case 'dnd':
            this._updateBadges();
            if (settled && this._s.get_boolean('dnd-enabled')) {
                this._dndAct.setOn(sys.dnd);
                this._m.flash(this._dndAct, dur);
            }
            break;
        case 'caffeine':
            this._updateBadges();
            if (settled) {
                this._flashStatus(sys.caffeine ? (this._icons.caffeine ?? 'view-reveal-symbolic') : 'view-conceal-symbolic',
                    sys.caffeine ? 'Caffeine on' : 'Caffeine off');
            }
            break;
        case 'airplane':
            this._updateBadges();
            if (settled)
                this._flashStatus('airplane-mode-symbolic', this._airplaneOn() ? 'Airplane mode on' : 'Airplane mode off');
            break;
        case 'volume':
            // no pill popup for volume changes made by apps or calls (e.g. Discord); only keys and pill scroll show it
            this._lastVol = `${Math.round(sys.volume * 100)}${sys.muted}`;
            break;
        case 'brightness': {
            if (!sys.brightnessAvailable)
                break;
            const b = Math.round(sys.brightness * 100);
            const prevBri = this._lastBri ?? b;
            const changed = this._lastBri !== null && b !== this._lastBri;
            this._lastBri = b;
            if (!changed || !settled || !this._features.osd)
                break;
            if (GLib.get_monotonic_time() - this._lastNativeOsd < 500000)
                break;
            try {
                // ignore slow automatic drifts (auto-brightness, idle dimming): big jumps or recent user activity count
                const jump = Math.abs(b - prevBri) >= 4;
                if (!jump && global.backend.get_core_idle_monitor().get_idletime() > 4000)
                    break;
            } catch (_e) { /* idle monitor unavailable */ }
            this._osdAct.show({icon: this._brightnessIcon(), value: b / 100});
            this._m.flash(this._osdAct, this._s.get_int('instant-duration'));
            break;
        }
        case 'mic':
            this._pill.setMicActive(sys.micActive);
            break;
        default:
            break;
        }
    }

    _brightnessIcon() {
        this._briIcon ??= new Gio.FileIcon({file: Gio.File.new_for_path(`${this._ext.path}/icons/brightness-symbolic.svg`)});
        return this._briIcon;
    }

    // short "icon + text" popup reusing the DND activity layout
    _flashStatus(icon, text) {
        this._dndAct.setCustom(icon, text);
        this._m.flash(this._dndAct, this._s.get_int('status-duration'));
    }

    // ---------- music
    _startMusic() {
        const m = this._service('mpris');
        this._unsubMpris = m.onChanged(() => this._onMpris());
        this._onMpris();
    }

    _stopMusic() {
        this._unsubMpris?.();
        this._unsubMpris = null;
        this._bag.cancel(this._pausedTimer);
        this._pausedTimer = 0;
        this._m.setAvailable(this._music, false);
        this._music.setPlayer(null);
        this._music.setLyrics(null);
        this._lyricsKey = null;
        this._dropService('mpris');
        this._dropService('lyrics');
    }

    _onMpris() {
        const p = this._svc.mpris?.active ?? null;
        this._music.setPlayer(p);
        if (p?.status === 'Playing') {
            this._bag.cancel(this._pausedTimer);
            this._pausedTimer = 0;
            this._m.setAvailable(this._music, true);
        } else if (p) {
            if (this._music.available && !this._pausedTimer) {
                this._pausedTimer = this._bag.timeout(60000, () => {
                    this._pausedTimer = 0;
                    this._m.setAvailable(this._music, false);
                    return false;
                });
            }
        } else {
            this._bag.cancel(this._pausedTimer);
            this._pausedTimer = 0;
            this._m.setAvailable(this._music, false);
        }

        const key = p ? `${p.meta.artist}|${p.meta.title}|${p.meta.length}` : '';
        if (key === this._lyricsKey)
            return;
        this._lyricsKey = key;
        this._music.setLyrics(null);
        if (p && p.meta.title && this._s.get_boolean('lyrics-enabled')) {
            this._service('lyrics').fetch(p.meta).then(lines => {
                if (this._lyricsKey === key && this._features.music)
                    this._music.setLyrics(lines);
            }).catch(e => console.warn(`minie-pill: lyrics failed: ${e.message}`));
        }
    }

    _onMiddleClick(activity) {
        if (activity?.id === 'music')
            this._svc.mpris?.active?.playPause();
    }

    // ---------- bluetooth
    _startBt() {
        const bt = this._service('bluetooth');
        this._unsubBt = bt.onChanged(ev => this._onBt(ev));
        this._onBt({type: 'init'});
    }

    _stopBt() {
        this._unsubBt?.();
        this._unsubBt = null;
        this._m.setAvailable(this._btAct, false);
        this._dropService('bluetooth');
    }

    _onBt(ev) {
        const dur = this._s.get_int('status-duration');
        const bt = this._svc.bluetooth;
        if (!bt)
            return;
        const list = bt.connected();
        this._m.setAvailable(this._btAct, bt.powered || list.length > 0);

        if (ev.type === 'disconnected' && ev.device) {
            this._btAct.showDevice(ev.device, false);
            this._m.flash(this._btAct, dur);
            // after the popup, settle on the remaining device / "No device connected"
            this._bag.timeout(dur + 150, () => {
                if (this._features.bt)
                    this._onBt({type: 'update'});
                return false;
            });
            return;
        }
        if (!list.length) {
            this._btAct.showDevice(null, false);
            return;
        }
        let sel = list.find(d => d.path === this._btSel) ?? list[0];
        if (ev.type === 'connected' && ev.device) {
            sel = ev.device;
            this._btSel = sel.path;
        }
        this._btAct.showDevice(sel, true);
        if (ev.type === 'connected') {
            console.log(`minie-pill: bluetooth connected: ${sel.name} icon=${sel.icon} kind=${BluetoothService.kindOf(sel)} battery=${sel.battery}`);
            this._m.flash(this._btAct, dur);
        }
    }

    _openBtPicker() {
        const devs = this._svc.bluetooth?.connected() ?? [];
        if (devs.length < 2)
            return false;
        const inner = new St.BoxLayout({vertical: true, style_class: 'minie-panel minie-picker'});
        for (const d of devs) {
            const b = new St.Button({style_class: 'minie-app-row', can_focus: true, reactive: true, track_hover: true, x_expand: true, x_align: Clutter.ActorAlign.FILL});
            const r = new St.BoxLayout({x_expand: true});
            r.add_child(makeIcon(this._deviceIcon(d), 20));
            r.add_child(makeLabel(BluetoothService.nameOf(d), 'minie-text'));
            if (d.battery !== null && d.battery !== undefined) {
                const bb = new St.BoxLayout({x_expand: true, x_align: Clutter.ActorAlign.END, style: 'spacing: 6px;'});
                const g = new BatteryGlyph(22, 11);
                g.set(d.battery);
                bb.add_child(g.actor);
                bb.add_child(new St.Label({text: `${d.battery}%`, style_class: 'minie-title', y_align: Clutter.ActorAlign.CENTER}));
                r.add_child(bb);
            }
            if (d.path === this._btSel)
                b.add_style_pseudo_class('active');
            b.set_child(r);
            b.connect('clicked', () => {
                this._btSel = d.path;
                this._btAct.showDevice(d, true);
                this._picker.close();
            });
            inner.add_child(b);
        }
        const shell = squircleShell(this._s, inner, 24);
        shell.set_width(300);
        const ok = this._picker.open(shell, this._pill.bottom + 8, {width: this._pill.width, height: this._pill.height});
        if (!ok)
            shell.destroy();
        return ok;
    }

    // ---------- wifi
    _startWifi() {
        const n = this._service('network');
        this._unsubWifi = n.onChanged(ev => this._onWifi(ev));
        this._onWifi({type: 'init'});
    }

    _stopWifi() {
        this._unsubWifi?.();
        this._unsubWifi = null;
        this._m.setAvailable(this._wifiAct, false);
        this._dropService('network');
    }

    _onWifi(ev) {
        const n = this._svc.network;
        if (!n)
            return;
        const on = !!n.ssid;
        this._m.setAvailable(this._wifiAct, on);
        if (!on)
            return;
        this._wifiAct.ensureActor();
        this._wifiAct.update(n.ssid, n.strength);
        if (ev.type === 'connected')
            this._m.flash(this._wifiAct, this._s.get_int('status-duration'));
    }

    // ---------- weather in pill
    _startWeather() {
        this._fetchWeather(false, true);
        this._weatherTimer = this._bag.timeout(WEATHER_REFRESH_MS, () => {
            this._fetchWeather(true, false);
            return true;
        });
    }

    _stopWeather() {
        this._bag.cancel(this._weatherTimer);
        this._weatherTimer = 0;
        this._m.setAvailable(this._weatherAct, false);
    }

    _fetchWeather(force, announce) {
        const s = this._s;
        if (!s.get_string('weather-name') && s.get_double('weather-lat') === 0 && s.get_double('weather-lon') === 0) {
            this._m.setAvailable(this._weatherAct, false);
            return;
        }
        this._service('weather').get(s, force).then(data => {
            if (!this._features.weather)
                return;
            this._weatherAct.ensureActor();
            this._weatherAct.update(data, s.get_string('weather-units'), s.get_string('weather-name'));
            this._m.setAvailable(this._weatherAct, true);
            if (announce)
                this._m.flash(this._weatherAct, s.get_int('status-duration'));
        }).catch(e => {
            console.warn(`minie-pill: weather failed: ${e.message}`);
            this._m.setAvailable(this._weatherAct, false);
        });
    }

    // ---------- notifications
    _startNotif() {
        this._notifSvc = new NotificationService(this._s, n => this._onNotification(n));
        this._notifSvc.start();
    }

    _stopNotif() {
        this._notifSvc?.destroy();
        this._notifSvc = null;
    }

    _onNotification(n) {
        if (this._service('system').dnd)
            return;
        this._notifAct.show(n);
        this._m.flash(this._notifAct, this._s.get_int('notif-duration') * 1000);
    }

    _activateNotification(n) {
        try {
            n?.activate();
        } catch (e) {
            console.warn(`minie-pill: notification activate failed: ${e.message}`);
        }
        this._m.endFlash();
    }

    // ---------- OSD (volume / brightness) - replaces GNOME's popup
    _startOsd() {
        const osd = Main.osdWindowManager;
        const self = this;
        this._osdPatched = [];
        for (const name of ['show', 'showAll']) {
            if (typeof osd[name] !== 'function')
                continue;
            const orig = osd[name];
            const hadOwn = Object.prototype.hasOwnProperty.call(osd, name);
            this._osdPatched.push({name, orig, hadOwn});
            osd[name] = function (...args) {
                // show(monitor, icon, label, level, max)  |  showAll(icon, label, level, max)
                const [icon, level] = name === 'show' ? [args[1], args[3]] : [args[0], args[2]];
                if (self._handleOsd(icon, level))
                    return undefined;
                return orig.apply(this, args);
            };
        }
    }

    _stopOsd() {
        const osd = Main.osdWindowManager;
        for (const {name, orig, hadOwn} of this._osdPatched ?? []) {
            if (hadOwn)
                osd[name] = orig;
            else
                delete osd[name];
        }
        this._osdPatched = [];
    }

    _handleOsd(icon, level) {
        if (level === undefined || level === null || !this._features.osd)
            return false;
        let name = '';
        try { name = icon ? icon.to_string() : ''; } catch (_e) { name = ''; }
        if (!/audio-volume|brightness/.test(name))
            return false;
        this._lastNativeOsd = GLib.get_monotonic_time();
        if (level > 1.5)
            level /= 100;
        this._osdAct.show({icon: /brightness/.test(name) ? this._brightnessIcon() : icon, value: level});
        this._m.flash(this._osdAct, this._s.get_int('instant-duration'));
        return true;
    }

    // scroll on pill while music plays: amount = wheel notches (+down / -up)
    _volumeScroll(amount) {
        const sys = this._service('system');
        sys.stepVolume(-amount * 0.05);
        if (!sys.volumeAvailable)
            return;
        this._lastVol = `${Math.round(sys.volume * 100)}${sys.muted}`;
        this._osdAct.show({icon: Gio.ThemedIcon.new(volumeIcon(sys.volume, sys.muted)), value: sys.volume});
        this._m.flash(this._osdAct, this._s.get_int('instant-duration'));
    }

    // ---------- workspace dots
    _startWs() {
        const wm = global.workspace_manager;
        this._wsLast = wm.get_active_workspace_index();
        const handler = () => {
            const idx = wm.get_active_workspace_index();
            if (idx === this._wsLast)
                return;
            this._wsLast = idx;
            if (Main.overview.visible)
                return;
            this._wsAct.show(wm.n_workspaces, idx);
            this._m.flash(this._wsAct, 1300);
        };
        this._wsIds = [wm.connect('workspace-switched', handler), wm.connect('active-workspace-changed', handler)];
    }

    _stopWs() {
        for (const id of this._wsIds ?? []) {
            try { global.workspace_manager.disconnect(id); } catch (_e) { /* gone */ }
        }
        this._wsIds = [];
    }

    // ---------- cat: every N seconds it takes over the pill and runs across it
    _scheduleCat(delayMs) {
        this._bag.cancel(this._catTimer);
        this._catTimer = this._bag.timeout(Math.max(1000, delayMs), () => {
            this._catTimer = 0;
            this._runCat(false);
            return false;
        });
    }

    _runCat(force) {
        const busy = this._panel.isOpen || this._picker.isOpen || this._m.flashing();
        if (busy && !force) {
            if (this._features.cat)
                this._scheduleCat(3000);
            return;
        }
        const ms = this._catAct.begin();
        this._m.flash(this._catAct, ms + 250);
        if (this._features.cat) {
            const jitter = this._s.get_boolean('cat-interval-jitter') ? 0.5 + Math.random() : 1;
            this._scheduleCat(ms + this._s.get_int('cat-interval') * 1000 * jitter);
        }
    }

    // ---------- screen recording (GNOME's built-in recorder)
    _recordingNow() {
        const ui = Main.screenshotUI;
        return !!(ui?.screencast_in_progress ?? ui?._screencastInProgress);
    }

    _startRecord() {
        const ui = Main.screenshotUI;
        if (!ui)
            return;
        this._recording = false;
        this._recId = ui.connect('notify::screencast-in-progress', () => this._onRecord());
        this._onRecord();
    }

    _stopRecord() {
        if (this._recId) {
            try { Main.screenshotUI.disconnect(this._recId); } catch (_e) { /* gone */ }
        }
        this._recId = 0;
        this._recording = false;
        this._m.setAvailable(this._recAct, false);
    }

    _onRecord() {
        const on = this._recordingNow();
        if (on && !this._recording) {
            this._recording = true;
            this._recAct.begin();
            this._m.setAvailable(this._recAct, true);
        } else if (!on && this._recording) {
            this._recording = false;
            this._m.setAvailable(this._recAct, false);
            this._recAct.setSaved();
            this._m.flash(this._recAct, 2500);
        }
    }

    // ---------- downloads
    _startDownloads() {
        const svc = this._service('downloads');
        this._unsubDl = svc.onChanged(ev => this._onDownload(ev));
        this._onDownload({type: 'init'});
    }

    _stopDownloads() {
        this._unsubDl?.();
        this._unsubDl = null;
        this._m.setAvailable(this._downAct, false);
        this._dropService('downloads');
    }

    _onDownload(ev) {
        const svc = this._svc.downloads;
        if (!svc)
            return;
        const sum = svc.summary();
        if (sum) {
            this._downAct.setProgress(sum);
            this._m.setAvailable(this._downAct, true);
        } else {
            this._m.setAvailable(this._downAct, false);
        }
        if (ev.type === 'done') {
            this._downAct.setDone(ev.name, ev.path);
            this._m.flash(this._downAct, 5000);
        }
    }

    _openDownload(path) {
        try {
            const target = path ? Gio.File.new_for_path(path) : Gio.File.new_for_path(this._svc.downloads?.dir ?? GLib.get_home_dir());
            Gio.AppInfo.launch_default_for_uri(target.get_uri(), global.create_app_launch_context(0, -1));
        } catch (e) {
            console.warn(`minie-pill: cannot open download: ${e.message}`);
        }
    }

    // ---------- pill click
    _onPillClick(activity) {
        if (!activity || activity.id === 'idle') {
            if (this._s.get_boolean('popup-on-click'))
                this._panel.toggle('home');
            return;
        }
        if (activity.onClick())
            return;
        if (!this._s.get_boolean('popup-on-click'))
            return;
        this._panel.toggle(activity.tab ?? 'home');
    }
}

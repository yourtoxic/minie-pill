import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const PREFIX = 'org.mpris.MediaPlayer2.';
const PATH = '/org/mpris/MediaPlayer2';
const IFACE = 'org.mpris.MediaPlayer2.Player';

class Player {
    constructor(service, name) {
        this.service = service;
        this.name = name;
        this.proxy = null;
        this.status = 'Stopped';
        this.meta = {title: '', artist: '', album: '', artUrl: '', length: 0, trackId: ''};
        this.lastPlayed = 0;
        this._posUs = 0;
        this._posAt = 0;
        this._ids = [];
    }

    init(cancellable) {
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null,
            this.name, PATH, IFACE, cancellable, (_o, res) => {
                try {
                    this.proxy = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (_e) {
                    return;
                }
                this._ids.push(this.proxy.connect('g-properties-changed', () => this._read(true)));
                this._ids.push(this.proxy.connect('g-signal', (_p, _s, signal, params) => {
                    if (signal === 'Seeked') {
                        this._posUs = Number(params.deepUnpack()[0]);
                        this._posAt = GLib.get_monotonic_time();
                        this.service._emit();
                    }
                }));
                this._read(true);
                this._fetchPosition();
            });
    }

    _read(emit) {
        if (!this.proxy)
            return;
        const prevStatus = this.status;
        const st = this.proxy.get_cached_property('PlaybackStatus');
        this.status = st ? st.unpack() : 'Stopped';
        const md = this.proxy.get_cached_property('Metadata');
        const m = md ? md.recursiveUnpack() : {};
        const artist = Array.isArray(m['xesam:artist']) ? m['xesam:artist'].join(', ') : (m['xesam:artist'] ?? '');
        this.meta = {
            title: m['xesam:title'] ?? '',
            artist,
            album: m['xesam:album'] ?? '',
            artUrl: m['mpris:artUrl'] ?? '',
            length: Number(m['mpris:length'] ?? 0),
            trackId: m['mpris:trackid'] ?? '',
        };
        if (this.status === 'Playing') {
            if (prevStatus !== 'Playing') {
                this.lastPlayed = GLib.get_monotonic_time();
                this._fetchPosition();
            }
        } else if (prevStatus === 'Playing') {
            this._posUs = this.position();
            this._posAt = GLib.get_monotonic_time();
        }
        if (emit)
            this.service._emit();
    }

    _fetchPosition() {
        if (!this.proxy)
            return;
        this.proxy.call('org.freedesktop.DBus.Properties.Get',
            new GLib.Variant('(ss)', [IFACE, 'Position']), Gio.DBusCallFlags.NONE, -1, null, (p, res) => {
                try {
                    const r = p.call_finish(res).recursiveUnpack();
                    this._posUs = Number(r[0]);
                    this._posAt = GLib.get_monotonic_time();
                    this.service._emit();
                } catch (_e) { /* player does not expose Position */ }
            });
    }

    // current position in microseconds (interpolated while playing)
    position() {
        let pos = this._posUs;
        if (this.status === 'Playing')
            pos += GLib.get_monotonic_time() - this._posAt;
        if (this.meta.length > 0)
            pos = Math.min(pos, this.meta.length);
        return Math.max(0, pos);
    }

    _call(method, params = null) {
        this.proxy?.call(method, params, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    playPause() { this._call('PlayPause'); }
    next() { this._call('Next'); }
    previous() { this._call('Previous'); }

    setPosition(us) {
        if (!this.proxy || !this.meta.trackId)
            return;
        this._posUs = us;
        this._posAt = GLib.get_monotonic_time();
        this._call('SetPosition', new GLib.Variant('(ox)', [this.meta.trackId, Math.round(us)]));
    }

    destroy() {
        for (const id of this._ids) {
            try { this.proxy.disconnect(id); } catch (_e) { /* gone */ }
        }
        this._ids = [];
        this.proxy = null;
    }
}

export class MprisService {
    constructor() {
        this._players = new Map();
        this._cbs = new Set();
        this._cancel = new Gio.Cancellable();
        this._sub = 0;
    }

    start() {
        this._sub = Gio.DBus.session.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, _sig, params) => {
                const [name, , newOwner] = params.deepUnpack();
                if (!name.startsWith(PREFIX))
                    return;
                if (newOwner)
                    this._add(name);
                else
                    this._remove(name);
            });
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1, this._cancel,
            (conn, res) => {
                try {
                    const [names] = conn.call_finish(res).deepUnpack();
                    names.filter(n => n.startsWith(PREFIX)).forEach(n => this._add(n));
                } catch (_e) { /* cancelled or bus error */ }
            });
    }

    _add(name) {
        if (this._players.has(name) || name.includes('playerctld'))
            return;
        const p = new Player(this, name);
        this._players.set(name, p);
        p.init(this._cancel);
    }

    _remove(name) {
        const p = this._players.get(name);
        if (!p)
            return;
        p.destroy();
        this._players.delete(name);
        this._emit();
    }

    // best player: most recently playing, else a paused one with a title
    get active() {
        let best = null;
        for (const p of this._players.values()) {
            if (!p.meta.title)
                continue;
            if (p.status === 'Playing' && (!best || best.status !== 'Playing' || p.lastPlayed > best.lastPlayed))
                best = p;
            else if (p.status === 'Paused' && (!best || (best.status !== 'Playing' && p.lastPlayed > best.lastPlayed)))
                best = p;
        }
        return best;
    }

    onChanged(cb) {
        this._cbs.add(cb);
        return () => this._cbs.delete(cb);
    }

    _emit() {
        for (const cb of [...this._cbs])
            cb();
    }

    destroy() {
        this._cancel.cancel();
        if (this._sub)
            Gio.DBus.session.signal_unsubscribe(this._sub);
        for (const p of this._players.values())
            p.destroy();
        this._players.clear();
        this._cbs.clear();
    }
}

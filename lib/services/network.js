import NM from 'gi://NM';

export function signalIcon(strength) {
    if (strength > 80) return 'network-wireless-signal-excellent-symbolic';
    if (strength > 55) return 'network-wireless-signal-good-symbolic';
    if (strength > 30) return 'network-wireless-signal-ok-symbolic';
    if (strength > 5) return 'network-wireless-signal-weak-symbolic';
    return 'network-wireless-signal-none-symbolic';
}

export class NetworkService {
    constructor() {
        this._client = null;
        this._cbs = new Set();
        this._clientIds = [];
        this._devIds = [];
        this._apIds = [];
        this._bucket = -1;
        this.ssid = null;
        this.strength = 0;
        this.enabled = false;
        this._dead = false;
    }

    start() {
        NM.Client.new_async(null, (_o, res) => {
            if (this._dead)
                return;
            try {
                this._client = NM.Client.new_finish(res);
            } catch (_e) {
                return;
            }
            const c = this._client;
            for (const sig of ['notify::wireless-enabled', 'device-added', 'device-removed', 'notify::active-connections'])
                this._clientIds.push(c.connect(sig, () => this._rewire()));
            this._rewire();
        });
    }

    _unwire() {
        for (const [o, id] of [...this._devIds, ...this._apIds]) {
            try { o.disconnect(id); } catch (_e) { /* gone */ }
        }
        this._devIds = [];
        this._apIds = [];
    }

    _rewire() {
        this._unwire();
        for (const d of this._client.get_devices()) {
            if (!(d instanceof NM.DeviceWifi))
                continue;
            this._devIds.push([d, d.connect('notify::active-access-point', () => this._rewire())]);
            this._devIds.push([d, d.connect('state-changed', () => this._recompute())]);
            const ap = d.get_active_access_point();
            if (ap)
                this._apIds.push([ap, ap.connect('notify::strength', () => this._recompute(true))]);
        }
        this._recompute();
    }

    _recompute(strengthOnly = false) {
        if (!this._client)
            return;
        const prevSsid = this.ssid;
        let ssid = null, strength = 0;
        for (const d of this._client.get_devices()) {
            if (!(d instanceof NM.DeviceWifi) || d.get_state() !== NM.DeviceState.ACTIVATED)
                continue;
            const ap = d.get_active_access_point();
            if (ap && ap.get_ssid()) {
                ssid = NM.utils_ssid_to_utf8(ap.get_ssid().get_data());
                strength = ap.get_strength();
            }
        }
        const bucket = Math.floor(strength / 20);
        if (strengthOnly && bucket === this._bucket && ssid === prevSsid)
            return;
        this._bucket = bucket;
        this.ssid = ssid;
        this.strength = strength;
        this.enabled = this._client.wireless_enabled;
        this._emit({type: ssid !== prevSsid ? (ssid ? 'connected' : 'disconnected') : 'update'});
    }

    setEnabled(v) {
        if (this._client)
            this._client.wireless_set_enabled(v);
    }

    onChanged(cb) {
        this._cbs.add(cb);
        return () => this._cbs.delete(cb);
    }

    _emit(ev) {
        for (const cb of [...this._cbs])
            cb(ev);
    }

    destroy() {
        this._dead = true;
        this._unwire();
        for (const id of this._clientIds) {
            try { this._client.disconnect(id); } catch (_e) { /* gone */ }
        }
        this._clientIds = [];
        this._client = null;
        this._cbs.clear();
    }
}

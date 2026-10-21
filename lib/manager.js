import GLib from 'gi://GLib';

// Decides which activity the pill shows.
//  primary activities (music, timer, clock) are shown automatically (highest priority).
//  status activities (bluetooth, wifi, dnd) show on events (flash) or when user scrolls to them.
//  transient activities (notification, osd, workspace) only ever flash, then previous view is restored.
export class ActivityManager {
    constructor() {
        this._all = [];
        this._manual = null;
        this._flash = null;
        this._flashId = 0;
        this._listeners = new Set();
        this._last = undefined;
    }

    add(a) {
        a.manager = this;
        this._all.push(a);
        return a;
    }

    onChange(cb) {
        this._listeners.add(cb);
        return () => this._listeners.delete(cb);
    }

    list() {
        return this._all.filter(a => a.available && !a.transient).sort((x, y) => y.priority - x.priority);
    }

    resolve() {
        if (this._flash)
            return this._flash;
        if (this._manual && this._manual.available)
            return this._manual;
        this._manual = null;
        return this.list().find(a => a.kind === 'primary') ?? null;
    }

    setAvailable(a, value) {
        value = !!value;
        if (a.available === value)
            return;
        a.available = value;
        if (value && a.kind === 'primary' && this._manual && a.priority > this._manual.priority)
            this._manual = null;
        this._notify(false);
    }

    cycle(dir) {
        const list = this.list();
        if (list.length < 2)
            return;
        this._endFlashSilently();
        const cur = this._manual && this._manual.available ? this._manual : this.resolve();
        let i = list.indexOf(cur);
        if (i < 0)
            i = 0;
        this._manual = list[(i + dir + list.length) % list.length];
        this._notify(false);
    }

    flash(a, ms) {
        const same = this._flash === a;
        this._flash = a;
        if (this._flashId)
            GLib.Source.remove(this._flashId);
        this._flashId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._flashId = 0;
            this._flash = null;
            this._notify(false);
            return GLib.SOURCE_REMOVE;
        });
        this._notify(same);
    }

    flashing() { return !!this._flash; }

    endFlash() {
        this._endFlashSilently();
        this._notify(false);
    }

    requestResize(a) {
        if (this.resolve() === a)
            this._notify(true);
    }

    _endFlashSilently() {
        if (this._flashId) {
            GLib.Source.remove(this._flashId);
            this._flashId = 0;
        }
        this._flash = null;
    }

    _notify(resize) {
        const cur = this.resolve();
        if (cur === this._last && !resize)
            return;
        this._last = cur;
        for (const cb of [...this._listeners])
            cb(cur, {resize});
    }

    destroy() {
        this._endFlashSilently();
        this._listeners.clear();
        for (const a of this._all)
            a.destroy();
        this._all = [];
    }
}

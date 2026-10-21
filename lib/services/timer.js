import GLib from 'gi://GLib';

// Countdown timer. states: idle | running | paused | finished
export class TimerService {
    constructor() {
        this.state = 'idle';
        this.total = 0;
        this._endAt = 0;
        this._left = 0;
        this._src = 0;
        this._cbs = new Set();
    }

    start() { /* lazily driven */ }

    get remaining() {
        if (this.state === 'running')
            return Math.max(0, Math.ceil((this._endAt - GLib.get_monotonic_time()) / 1e6));
        return this._left;
    }

    begin(seconds) {
        this._stopTick();
        this.total = seconds;
        this._left = seconds;
        this._resume();
    }

    _resume() {
        this.state = 'running';
        this._endAt = GLib.get_monotonic_time() + this._left * 1e6;
        this._stopTick();
        this._src = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            if (this.remaining <= 0) {
                this._src = 0;
                this._left = 0;
                this.state = 'finished';
                this._emit('finished');
                return GLib.SOURCE_REMOVE;
            }
            this._emit('tick');
            return GLib.SOURCE_CONTINUE;
        });
        this._emit('state');
    }

    pause() {
        if (this.state !== 'running')
            return;
        this._left = this.remaining;
        this.state = 'paused';
        this._stopTick();
        this._emit('state');
    }

    resume() {
        if (this.state === 'paused')
            this._resume();
    }

    reset() {
        this._stopTick();
        this.state = 'idle';
        this._left = 0;
        this.total = 0;
        this._emit('state');
    }

    _stopTick() {
        if (this._src) {
            GLib.Source.remove(this._src);
            this._src = 0;
        }
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
        this._stopTick();
        this._cbs.clear();
    }
}

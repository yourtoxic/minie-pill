import GLib from 'gi://GLib';

// Damped spring integrator (mass / stiffness / damping). Springs keep their velocity when the target
// changes mid-flight, so interrupted animations curve smoothly to the new state instead of restarting.
export class SpringGroup {
    constructor(getParams, onFrame) {
        this._params = getParams;
        this._frame = onFrame;
        this._s = new Map();
        this._src = 0;
        this._last = 0;
    }

    add(key, value, eps = 0.25) {
        this._s.set(key, {x: value, v: 0, t: value, eps});
    }

    get(key) { return this._s.get(key).x; }
    target(key) { return this._s.get(key).t; }

    setTarget(key, t) {
        const s = this._s.get(key);
        if (s.t === t)
            return;
        s.t = t;
        this._kick();
    }

    jump(key, x) {
        const s = this._s.get(key);
        s.x = x;
        s.t = x;
        s.v = 0;
    }

    _kick() {
        if (this._src)
            return;
        this._last = GLib.get_monotonic_time();
        this._src = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 8, () => this._tick());
    }

    _tick() {
        const now = GLib.get_monotonic_time();
        const dt = Math.min((now - this._last) / 1e6, 0.05);
        this._last = now;
        const {mass, stiffness, damping} = this._params();
        const h = 1 / 480;
        let rem = dt;
        while (rem > 1e-9) {
            const step = Math.min(h, rem);
            rem -= step;
            for (const s of this._s.values()) {
                const a = (-stiffness * (s.x - s.t) - damping * s.v) / mass;
                s.v += a * step;
                s.x += s.v * step;
            }
        }
        let settled = true;
        for (const s of this._s.values()) {
            if (Math.abs(s.x - s.t) < s.eps && Math.abs(s.v) < s.eps * 16) {
                s.x = s.t;
                s.v = 0;
            } else {
                settled = false;
            }
        }
        this._frame();
        if (settled) {
            this._src = 0;
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    }

    destroy() {
        if (this._src)
            GLib.Source.remove(this._src);
        this._src = 0;
    }
}

export function springParams(settings) {
    const speed = Math.max(0.2, settings.get_int('animation-speed') / 100);
    return {
        mass: Math.max(0.1, settings.get_double('spring-mass')),
        stiffness: settings.get_double('spring-stiffness') * speed * speed,
        damping: settings.get_double('spring-damping') * speed,
    };
}

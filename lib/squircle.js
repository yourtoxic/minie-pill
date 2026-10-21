import St from 'gi://St';
import Clutter from 'gi://Clutter';

// "rgb(0,0,0)", "rgba(0,0,0,.5)", "#000", "#000000", "#00000080" -> [r,g,b,a] in 0..1
export function parseColor(str, fallback = [0, 0, 0, 1]) {
    if (!str)
        return fallback;
    str = String(str).trim();
    let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(str);
    if (m) {
        const n = parseInt(m[1], 16);
        return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, m[2] ? parseInt(m[2], 16) / 255 : 1];
    }
    m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(str);
    if (m)
        return [parseInt(m[1] + m[1], 16) / 255, parseInt(m[2] + m[2], 16) / 255, parseInt(m[3] + m[3], 16) / 255, 1];
    m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(str);
    if (m)
        return [parseFloat(m[1]) / 255, parseFloat(m[2]) / 255, parseFloat(m[3]) / 255, m[4] === undefined ? 1 : parseFloat(m[4])];
    return fallback;
}

export function cssColor([r, g, b, a]) {
    return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

// Superellipse ("squircle") rounded rectangle path. n=2 is a normal circular corner, bigger = squarer/smoother.
export function traceSquircle(cr, x, y, w, h, r, n, append = false) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    const e = 2 / Math.max(2, n);
    const steps = Math.max(8, Math.min(48, Math.ceil(r * 1.2)));
    const corner = (cx, cy, sx, sy, t0, t1) => {
        for (let i = 0; i <= steps; i++) {
            const t = t0 + (t1 - t0) * i / steps;
            cr.lineTo(cx + sx * r * Math.pow(Math.abs(Math.cos(t)), e), cy + sy * r * Math.pow(Math.abs(Math.sin(t)), e));
        }
    };
    const H = Math.PI / 2;
    if (!append)
        cr.newPath();
    cr.moveTo(x + r, y);
    cr.lineTo(x + w - r, y);
    corner(x + w - r, y + r, 1, -1, H, 0);
    cr.lineTo(x + w, y + h - r);
    corner(x + w - r, y + h - r, 1, 1, 0, H);
    cr.lineTo(x + r, y + h);
    corner(x + r, y + h - r, -1, 1, H, 0);
    cr.lineTo(x, y + r);
    corner(x + r, y + r, -1, -1, 0, H);
    cr.closePath();
}

// Cairo-drawn background: anti-aliased fill + crisp inner 1px stroke.
export class SquircleBg {
    constructor(opts = {}) {
        this._o = {fill: [0, 0, 0, 1], stroke: null, lineWidth: 1, radius: 17, n: 2.6, ...opts};
        this.actor = new St.DrawingArea({x_expand: true, y_expand: true});
        this.actor.connect('repaint', () => this._paint());
    }

    set(opts) {
        Object.assign(this._o, opts);
        this.actor.queue_repaint();
    }

    _paint() {
        const cr = this.actor.get_context();
        const [w, h] = this.actor.get_surface_size();
        const o = this._o;
        if (w > 0 && h > 0) {
            const [fr, fg, fb, fa] = o.fill;
            if (o.stroke && o.lineWidth > 0) {
                // ring first (flattened over the opaque fill so the outer edge is ONE clean anti-aliased edge),
                // then the inside is replaced with the fill colour -> no dark fringe, no cracked border
                let [sr, sg, sb, sa] = o.stroke;
                if (fa >= 0.99) {
                    sr = sr * sa + fr * (1 - sa);
                    sg = sg * sa + fg * (1 - sa);
                    sb = sb * sa + fb * (1 - sa);
                    sa = 1;
                }
                const lw = o.lineWidth;
                traceSquircle(cr, 0, 0, w, h, o.radius, o.n);
                cr.setSourceRGBA(sr, sg, sb, sa);
                cr.fill();
                traceSquircle(cr, lw, lw, w - 2 * lw, h - 2 * lw, Math.max(0, o.radius - lw), o.n);
                cr.setOperator(1);              // CAIRO_OPERATOR_SOURCE
                cr.setSourceRGBA(fr, fg, fb, fa);
                cr.fill();
            } else {
                traceSquircle(cr, 0, 0, w, h, o.radius, o.n);
                cr.setSourceRGBA(fr, fg, fb, fa);
                cr.fill();
            }
        }
        cr.$dispose();
    }
}

// Wraps `inner` in a squircle-drawn panel background (used for the expanded panel and pickers).
export function squircleShell(settings, inner, radius = 30) {
    const outer = new St.Widget({layout_manager: new Clutter.BinLayout()});
    const fill = parseColor(settings.get_string('bg-color'));
    fill[3] = Math.max(fill[3], 0.97);
    const bg = new SquircleBg({fill, stroke: [1, 1, 1, 0.09], radius, n: 2 + settings.get_int('corner-smoothing') / 100 * 2.4});
    inner.set({x_expand: true, y_expand: true});
    outer.add_child(bg.actor);
    outer.add_child(inner);
    return outer;
}

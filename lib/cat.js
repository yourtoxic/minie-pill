import GLib from 'gi://GLib';

// Procedural dot-matrix cats. Every sprite is built from simple shapes in a 16-row design grid.
const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
function inTri(px, py, a, b, c) {
    const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
    const p = [px, py];
    const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
function nearSeg(px, py, x1, y1, x2, y2, th) {
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)) <= th / 2;
}
const poly = (px, py, pts, th) => {
    for (let i = 0; i < pts.length - 1; i++) {
        if (nearSeg(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], th))
            return true;
    }
    return false;
};

// ---- shape tests (design grid, y grows downward) -> true when the point is part of the cat
function walker(gx, gy, phase) {
    gy -= Math.sin(phase * 2) * 0.35;
    if (inEllipse(gx, gy, 13, 8, 9, 3.6) || inEllipse(gx, gy, 22, 6, 3.4, 3.2) ||
        inTri(gx, gy, [19.4, 3.6], [20.2, 0.2], [22, 3]) || inTri(gx, gy, [22, 3], [23.8, 0.2], [24.8, 3.8]) ||
        poly(gx, gy, [[4.5, 7], [2, 5.2], [1.2, 2.4], [2.6, 0.6]], 1.4))
        return true;
    for (const [hx, off] of [[7.5, 0], [10, Math.PI], [16, Math.PI], [18.5, 0]]) {
        if (nearSeg(gx, gy, hx, 10.5, hx + Math.sin(phase + off) * 2.3, 15, 1.7))
            return true;
    }
    return false;
}

function runner(gx, gy, phase) {
    gy += Math.abs(Math.sin(phase)) * -0.8;
    const tailY = Math.sin(phase) * 0.8;
    if (inEllipse(gx, gy, 15, 7.5, 10.5, 3) || inEllipse(gx, gy, 26.5, 6, 3.2, 3) ||
        inTri(gx, gy, [24.2, 3.6], [24.8, 0.6], [26.8, 3]) || inTri(gx, gy, [26.8, 3], [28.8, 0.8], [29.6, 3.8]) ||
        poly(gx, gy, [[5, 7], [1.8, 5.5 + tailY], [0, 3.6 + tailY]], 1.3))
        return true;
    for (const [hx, off] of [[22, 0], [20, 0.5], [9, Math.PI], [7.5, Math.PI + 0.5]]) {
        const swing = Math.sin(phase + off) * 4.5;
        const lift = Math.max(0, Math.cos(phase + off)) * 2.5;
        if (nearSeg(gx, gy, hx, 9.5, hx + swing, 14.8 - lift, 1.7))
            return true;
    }
    return false;
}

function prowler(gx, gy, phase) {
    const sway = Math.sin(phase * 0.5) * 0.9;
    if (inEllipse(gx, gy, 14, 10, 10, 2.5) || inEllipse(gx, gy, 24, 9.2, 2.8, 2.6) ||
        inTri(gx, gy, [22.4, 7.8], [22.8, 5], [24.6, 7.2]) || inTri(gx, gy, [24.6, 7.2], [26.4, 5], [26.8, 8.2]) ||
        poly(gx, gy, [[4.2, 10], [1.8, 9.6 + sway], [0.6, 8 + sway]], 1.3))
        return true;
    for (const [hx, off] of [[7, 0], [10, Math.PI], [17.5, Math.PI], [20.5, 0]]) {
        if (nearSeg(gx, gy, hx, 11.5, hx + Math.sin(phase + off) * 1.6, 15, 1.6))
            return true;
    }
    return false;
}

// sitting cat with cut-out eyes; the hop itself is applied by the painter
function sitter(gx, gy, phase) {
    const sway = Math.sin(phase * 3) * 0.7;
    const eyes = inEllipse(gx, gy, 5.5, 5, 0.75, 0.9) || inEllipse(gx, gy, 8.5, 5, 0.75, 0.9);
    if (eyes)
        return false;
    return inEllipse(gx, gy, 7, 5, 3.8, 3.5) || inTri(gx, gy, [3.4, 3.2], [4, 0], [6.4, 1.8]) ||
        inTri(gx, gy, [7.6, 1.8], [10, 0], [10.6, 3.2]) || inEllipse(gx, gy, 7, 11.6, 4.3, 4.4) ||
        poly(gx, gy, [[11, 14.6], [13.2, 13.2 + sway], [13.6, 10.4 + sway]], 1.4);
}

// cat chasing a mouse (mouse sits 36 grid cells to the right of the cat origin)
function chaser(gx, gy, phase) {
    if (walker(gx, gy, phase))
        return true;
    const mx = gx - 35, bob = Math.sin(phase * 3) * 0.3;
    const my = gy - bob;
    return inEllipse(mx, my, 4, 13.4, 3, 1.8) || inEllipse(mx, my, 7.3, 13.6, 1.4, 1.2) || inEllipse(mx, my, 6.2, 11.9, 0.9, 0.9) ||
        poly(mx, my, [[1.2, 13.9], [0.2, 14.8], [0.9, 15.4]], 0.7) ||
        nearSeg(mx, my, 3, 15, 3 + Math.sin(phase * 3) * 1.1, 15.8, 0.8);
}

// cat chasing a butterfly that flaps and bobs ahead of it
function butterflyChaser(gx, gy, phase) {
    if (walker(gx, gy, phase))
        return true;
    const bx = gx - 37, by = gy - 5.5 - Math.sin(phase * 1.4) * 2.2;
    const flap = 0.35 + 0.65 * Math.abs(Math.sin(phase * 4));
    return inEllipse(bx, by, 4.5, 0, 0.6, 1.9) || inEllipse(bx, by, 2.2, -0.7, 2.3 * flap, 1.9) ||
        inEllipse(bx, by, 6.8, -0.7, 2.3 * flap, 1.9) || inEllipse(bx, by, 2.8, 1.4, 1.5 * flap, 1.2) ||
        inEllipse(bx, by, 6.2, 1.4, 1.5 * flap, 1.2);
}

// cat following a fish
function fishChaser(gx, gy, phase) {
    if (walker(gx, gy, phase))
        return true;
    const fx = gx - 36, fy = gy - 12.2 - Math.sin(phase * 1.6) * 0.9;
    if (inEllipse(fx, fy, 5.2, 0, 3.4, 1.9) && !inEllipse(fx, fy, 7, -0.5, 0.55, 0.55))
        return true;
    return inTri(fx, fy, [2.2, 0], [-0.8, -2.1], [-0.8, 2.1]) || inTri(fx, fy, [4.4, -1.6], [5.8, -3], [6.4, -1.4]);
}

// cat on a skateboard (the board and wheels are drawn under a slightly smaller sitting cat)
function skater(gx, gy, phase) {
    if (gy < 13.2)
        return sitter(gx * 1.18, gy * 1.18, phase * 0.3);
    if (gy >= 13.3 && gy <= 14.5 && gx >= 0.4 && gx <= 13.6)
        return true;
    return inEllipse(gx, gy, 3.2, 15.3, 1, 0.95) || inEllipse(gx, gy, 10.8, 15.3, 1, 0.95);
}

// mother cat with a small kitten leading the way
function duo(gx, gy, phase) {
    return walker(gx, gy, phase) || walker((gx - 31) / 0.62, (gy - 6) / 0.62, phase + 1.3);
}

export const CAT_STYLES = {
    walker: {test: walker, width: 28, stride: 8, label: 'Walking cat'},
    runner: {test: runner, width: 32, stride: 6, label: 'Running cat'},
    prowler: {test: prowler, width: 30, stride: 10, label: 'Stalking cat'},
    hopper: {test: sitter, width: 14, stride: 14, label: 'Hopping cat', hop: 5, shrink: 0.7},
    chaser: {test: chaser, width: 45, stride: 7, label: 'Cat chasing a mouse'},
    butterfly: {test: butterflyChaser, width: 47, stride: 8, label: 'Cat chasing a butterfly'},
    fish: {test: fishChaser, width: 45, stride: 8, label: 'Cat following a fish'},
    skater: {test: skater, width: 14, stride: 12, label: 'Skateboarding cat'},
    duo: {test: duo, width: 49, stride: 7, label: 'Cat with a kitten'},
};

// {w, h, bits} for the given style at `rows` dot rows; `phase` animates legs / tail
export function catSprite(style, rows, phase) {
    const def = CAT_STYLES[style] ?? CAT_STYLES.walker;
    const f = rows / 16;
    const w = Math.max(1, Math.round(def.width * f));
    const bits = new Uint8Array(w * rows);
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < w; x++) {
            if (def.test((x + 0.5) / f, (y + 0.5) / f, phase))
                bits[y * w + x] = 1;
        }
    }
    return {w, h: rows, bits};
}

// draw a dot-matrix sprite: each lit bit is a round dot of size `cell`
export function drawDots(cr, sprite, x, y, cell, flip, rgba) {
    cr.setSourceRGBA(...rgba);
    const r = cell * 0.46;
    for (let sy = 0; sy < sprite.h; sy++) {
        for (let sx = 0; sx < sprite.w; sx++) {
            if (!sprite.bits[sy * sprite.w + sx])
                continue;
            const dx = flip ? sprite.w - 1 - sx : sx;
            cr.arc(x + (dx + 0.5) * cell, y + (sy + 0.5) * cell, r, 0, Math.PI * 2);
            cr.fill();
        }
    }
}

export const monotonicSeconds = () => GLib.get_monotonic_time() / 1e6;

// ---------------------------------------------------------------- effects
export const CAT_EFFECTS = ['paws', 'sparkles', 'hearts', 'dust', 'speed'];
const hash = n => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
};

function pawPrint(cr, x, y, cell, alpha) {
    cr.setSourceRGBA(1, 1, 1, alpha);
    cr.arc(x, y, cell * 1.0, 0, Math.PI * 2);
    cr.fill();
    for (const [dx, dy] of [[-1.3, -1.5], [0, -2.0], [1.3, -1.5]]) {
        cr.arc(x + dx * cell, y + dy * cell, cell * 0.55, 0, Math.PI * 2);
        cr.fill();
    }
}

function star(cr, x, y, r, rgba) {
    cr.setSourceRGBA(...rgba);
    cr.newPath();
    const pts = [[0, -1], [0.22, -0.22], [1, 0], [0.22, 0.22], [0, 1], [-0.22, 0.22], [-1, 0], [-0.22, -0.22]];
    pts.forEach(([dx, dy], i) => (i ? cr.lineTo(x + dx * r, y + dy * r) : cr.moveTo(x + dx * r, y + dy * r)));
    cr.closePath();
    cr.fill();
}

function heart(cr, x, y, r, alpha) {
    cr.setSourceRGBA(1, 0.42, 0.58, alpha);
    cr.arc(x - r * 0.5, y - r * 0.25, r * 0.55, 0, Math.PI * 2);
    cr.fill();
    cr.arc(x + r * 0.5, y - r * 0.25, r * 0.55, 0, Math.PI * 2);
    cr.fill();
    cr.newPath();
    cr.moveTo(x - r * 1.02, y - r * 0.05);
    cr.lineTo(x + r * 1.02, y - r * 0.05);
    cr.lineTo(x, y + r * 1.15);
    cr.closePath();
    cr.fill();
}

// p = {t, dist, speed, ltr, w, h, x, sw, sh, cell, ground}; drawn BEHIND the cat
export function drawEffect(cr, kind, p) {
    const {t, dist, speed, ltr, w, h, x, sw, cell, ground} = p;
    const dir = ltr ? 1 : -1;
    switch (kind) {
    case 'paws': {
        const gap = Math.max(16, sw * 0.6);
        const n = Math.floor(dist / gap);
        for (let k = n; k > n - 7 && k >= 0; k--) {
            const d = k * gap, age = dist - d;
            if (age < sw * 0.45)
                continue;
            const px = ltr ? -sw * 0.5 + d : w + sw * 0.5 - d;
            if (px < -6 || px > w + 6)
                continue;
            pawPrint(cr, px, ground - cell * 1.2 - (k % 2 ? cell * 1.3 : 0), cell * 0.9, Math.max(0, 1 - age / (gap * 6.5)) * 0.6);
        }
        break;
    }
    case 'sparkles': {
        const slot = Math.floor(t * 5), life = (t * 5) % 1;
        for (let i = 0; i < 6; i++) {
            const seed = slot * 7 + i * 13;
            const cx = x + sw / 2 + (hash(seed) - 0.5) * sw * 2.2;
            const cy = h * 0.5 + (hash(seed + 3) - 0.5) * h * 0.95;
            star(cr, cx, cy, cell * (1 + 2.2 * Math.sin(life * Math.PI)), [1, 0.92, 0.55, 0.9 * Math.sin(life * Math.PI)]);
        }
        break;
    }
    case 'hearts': {
        const step = 0.45, last = Math.floor(t / step);
        for (let k = last; k > last - 4; k--) {
            const age = t - k * step;
            if (k < 0 || age > 1.3)
                continue;
            const hx = x + sw * (0.35 + hash(k) * 0.4);
            heart(cr, hx + Math.sin(age * 5) * cell, h * 0.4 - age * h * 0.32, cell * 1.9, Math.max(0, 1 - age / 1.3));
        }
        break;
    }
    case 'dust': {
        const step = 0.08, last = Math.floor(t / step);
        for (let k = last; k > last - 7; k--) {
            const age = t - k * step;
            if (k < 0 || age > 0.5)
                continue;
            const px = x + sw * (ltr ? 0.15 : 0.85) - dir * age * speed * 0.25;
            cr.setSourceRGBA(1, 1, 1, 0.3 * (1 - age / 0.5));
            cr.arc(px, ground - cell * 1.5 - age * cell * 6, cell * (0.8 + age * 5), 0, Math.PI * 2);
            cr.fill();
        }
        break;
    }
    case 'speed': {
        cr.setLineCap(1);
        cr.setLineWidth(Math.max(1, cell * 0.8));
        for (let i = 0; i < 3; i++) {
            const ly = h * (0.3 + 0.2 * i);
            const len = sw * (0.45 + hash(i + 2) * 0.5) * (0.7 + 0.3 * Math.abs(Math.sin(t * 22 + i * 2)));
            const x0 = x + sw * (ltr ? 0.1 : 0.9) - dir * cell * 2;
            cr.setSourceRGBA(1, 1, 1, 0.38);
            cr.moveTo(x0, ly);
            cr.lineTo(x0 - dir * len, ly);
            cr.stroke();
        }
        break;
    }
    default:
        break;
    }
}

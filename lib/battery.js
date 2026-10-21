import St from 'gi://St';
import Clutter from 'gi://Clutter';

function roundRect(cr, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
    cr.closePath();
}

// Small Cairo battery glyph (theme independent).
export class BatteryGlyph {
    constructor(width = 24, height = 12) {
        this._pct = 100;
        this.actor = new St.DrawingArea({width, height, y_align: Clutter.ActorAlign.CENTER});
        this.actor.connect('repaint', () => this._paint());
    }

    set(pct) {
        this._pct = Math.max(0, Math.min(100, pct));
        this.actor.queue_repaint();
    }

    _paint() {
        const cr = this.actor.get_context();
        const [w, h] = this.actor.get_surface_size();
        const bodyW = w - 2.5;
        const low = this._pct <= 15;
        const col = low ? [1, 0.32, 0.3, 1] : [1, 1, 1, 0.95];
        cr.setSourceRGBA(col[0], col[1], col[2], 0.55);
        cr.setLineWidth(1);
        roundRect(cr, 0.5, 0.5, bodyW - 1, h - 1, 3);
        cr.stroke();
        cr.setSourceRGBA(...col);
        roundRect(cr, bodyW + 0.2, h * 0.32, 1.8, h * 0.36, 0.8);
        cr.fill();
        const fillW = Math.max(0, (bodyW - 4) * this._pct / 100);
        if (fillW > 0.5) {
            roundRect(cr, 2, 2, fillW, h - 4, 1.6);
            cr.fill();
        }
        cr.$dispose();
    }
}

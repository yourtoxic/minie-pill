import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {makeButton} from '../util.js';

export class CalendarTab {
    constructor(ctx) {
        this._ctx = ctx;
        this._view = GLib.DateTime.new_now_local();
        this.actor = new St.BoxLayout({vertical: true, style_class: 'minie-tab', x_expand: true, y_expand: true});
        this._render();
    }

    _render() {
        this.actor.destroy_all_children();
        const view = GLib.DateTime.new_local(this._view.get_year(), this._view.get_month(), 1, 0, 0, 0);
        const today = GLib.DateTime.new_now_local();
        const monday = this._ctx.settings.get_boolean('week-start-monday');

        const head = new St.BoxLayout({style_class: 'minie-row', x_expand: true});
        head.add_child(makeButton('go-previous-symbolic', () => this._move(-1)));
        const title = new St.Label({
            text: view.format('%B %Y') ?? '', style_class: 'minie-big-title', x_expand: true,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
        });
        head.add_child(title);
        head.add_child(makeButton('go-home-symbolic', () => { this._view = GLib.DateTime.new_now_local(); this._render(); }));
        head.add_child(makeButton('go-next-symbolic', () => this._move(1)));
        this.actor.add_child(head);

        // weekday names (2024-01-01 was a Monday)
        const names = [];
        for (let i = 0; i < 7; i++)
            names.push(GLib.DateTime.new_local(2024, 1, 1 + i, 0, 0, 0).format('%a') ?? '');
        const order = monday ? [0, 1, 2, 3, 4, 5, 6] : [6, 0, 1, 2, 3, 4, 5];
        const hdr = new St.BoxLayout({x_expand: true, style_class: 'minie-cal-row'});
        for (const i of order)
            hdr.add_child(this._cell(names[i], 'minie-cal-head'));
        this.actor.add_child(hdr);

        const dow = view.get_day_of_week();           // 1=Mon..7=Sun
        const offset = monday ? dow - 1 : dow % 7;
        const days = view.add_months(1).add_days(-1).get_day_of_month();
        let day = 1 - offset;
        for (let r = 0; r < 6; r++) {
            const rowBox = new St.BoxLayout({x_expand: true, style_class: 'minie-cal-row'});
            for (let c = 0; c < 7; c++, day++) {
                if (day < 1 || day > days) {
                    rowBox.add_child(this._cell('', 'minie-cal-day'));
                    continue;
                }
                const isToday = day === today.get_day_of_month() &&
                    view.get_month() === today.get_month() && view.get_year() === today.get_year();
                const cell = this._cell(String(day), isToday ? 'minie-cal-day minie-cal-today' : 'minie-cal-day');
                if (isToday)
                    cell.set_style(`background-color: ${this._ctx.settings.get_string('accent-color')}; color: #000;`);
                rowBox.add_child(cell);
            }
            this.actor.add_child(rowBox);
        }
    }

    _cell(text, cls) {
        return new St.Label({text, style_class: cls, x_expand: true, x_align: Clutter.ActorAlign.FILL});
    }

    _move(n) {
        this._view = this._view.add_months(n);
        this._render();
    }

    destroy() { this.actor.destroy(); }
}

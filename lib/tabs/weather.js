import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {makeIcon, makeButton} from '../util.js';
import {describeWeather} from '../weathercodes.js';

export class WeatherTab {
    constructor(ctx) {
        this._ctx = ctx;
        this._dead = false;
        this.actor = new St.BoxLayout({vertical: true, style_class: 'minie-tab', x_expand: true, y_expand: true});
        this._load(false);
    }

    _msg(text, withPrefs = false, retry = false) {
        this.actor.destroy_all_children();
        const box = new St.BoxLayout({vertical: true, x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.CENTER});
        const l = new St.Label({text, style_class: 'minie-sub', x_align: Clutter.ActorAlign.CENTER});
        l.clutter_text.line_wrap = true;
        l.set_width(Math.max(240, this._ctx.settings.get_int('panel-width') - 80));
        box.add_child(l);
        const btns = new St.BoxLayout({style_class: 'minie-controls', x_align: Clutter.ActorAlign.CENTER});
        btns.set_style('margin-top: 12px;');
        if (retry) {
            const r = new St.Button({label: 'Retry', style_class: 'minie-pillbtn', can_focus: true, reactive: true, track_hover: true});
            r.connect('clicked', () => this._load(true));
            btns.add_child(r);
        }
        if (withPrefs) {
            const b = new St.Button({label: 'Open preferences', style_class: 'minie-pillbtn', can_focus: true, reactive: true, track_hover: true});
            b.connect('clicked', () => { this._ctx.close(); this._ctx.ext.openPreferences(); });
            btns.add_child(b);
        }
        box.add_child(btns);
        this.actor.add_child(box);
    }

    async _load(force) {
        const s = this._ctx.settings;
        if (!s.get_string('weather-name') && s.get_double('weather-lat') === 0 && s.get_double('weather-lon') === 0) {
            this._msg('Set your city in preferences', true);
            return;
        }
        this._msg('Loading…');
        const svc = this._ctx.svc('weather');
        if (!svc) {
            this._msg('Weather service failed to start', true);
            return;
        }
        let data;
        try {
            data = await svc.get(s, force);
        } catch (e) {
            if (!this._dead)
                this._msg(`Weather failed — ${e.message}`, true, true);
            return;
        }
        if (this._dead)
            return;
        try {
            this._show(data);
        } catch (e) {
            console.warn(`minie-pill: weather render failed: ${e.message}\n${e.stack}`);
            this._msg(`Weather display error — ${e.message}`, false, true);
        }
    }

    _show(d) {
        this.actor.destroy_all_children();
        const imperial = this._ctx.settings.get_string('weather-units') === 'imperial';
        const t = imperial ? '°F' : '°C';
        const cur = d.current;
        const w = describeWeather(cur.weather_code, cur.is_day === 1);

        const head = new St.BoxLayout({style_class: 'minie-row', x_expand: true});
        head.add_child(makeIcon(w.icon, 56));
        const mid = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        mid.add_child(new St.Label({text: `${Math.round(cur.temperature_2m)}${t}`, style_class: 'minie-big'}));
        mid.add_child(new St.Label({text: `${w.text} · feels ${Math.round(cur.apparent_temperature)}${t}`, style_class: 'minie-sub'}));
        head.add_child(mid);
        head.add_child(makeButton('view-refresh-symbolic', () => this._load(true)));
        this.actor.add_child(head);

        const loc = this._ctx.settings.get_string('weather-name');
        const info = new St.Label({
            text: `${loc}   ·   Humidity ${cur.relative_humidity_2m}%   ·   Wind ${Math.round(cur.wind_speed_10m)} ${imperial ? 'mph' : 'km/h'}`,
            style_class: 'minie-sub',
        });
        info.set_style('margin: 8px 0 12px 0;');
        this.actor.add_child(info);

        const days = new St.BoxLayout({x_expand: true, style_class: 'minie-forecast'});
        const dl = d.daily;
        for (let i = 0; i < dl.time.length; i++) {
            const [y, m, dd] = dl.time[i].split('-').map(Number);
            const name = i === 0 ? 'Today' : (GLib.DateTime.new_local(y, m, dd, 0, 0, 0).format('%a') ?? '');
            const card = new St.BoxLayout({vertical: true, style_class: 'minie-card', x_expand: true});
            const dw = describeWeather(dl.weather_code[i], true);
            const nm = new St.Label({text: name, style_class: 'minie-sub', x_align: Clutter.ActorAlign.CENTER});
            const ic = makeIcon(dw.icon, 28);
            ic.x_align = Clutter.ActorAlign.CENTER;
            card.add_child(nm);
            card.add_child(ic);
            card.add_child(new St.Label({text: `${Math.round(dl.temperature_2m_max[i])}°`, x_align: Clutter.ActorAlign.CENTER, style_class: 'minie-title'}));
            card.add_child(new St.Label({text: `${Math.round(dl.temperature_2m_min[i])}°`, x_align: Clutter.ActorAlign.CENTER, style_class: 'minie-sub'}));
            days.add_child(card);
        }
        this.actor.add_child(days);
    }

    destroy() {
        this._dead = true;
        this.actor.destroy();
    }
}

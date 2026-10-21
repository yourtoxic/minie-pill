import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import {makeLabel} from '../util.js';

export class LauncherTab {
    constructor(ctx) {
        this._ctx = ctx;
        this._results = [];
        this.actor = new St.BoxLayout({vertical: true, style_class: 'minie-tab', x_expand: true, y_expand: true});
        this._entry = new St.Entry({hint_text: 'Search apps…', style_class: 'minie-entry', can_focus: true, x_expand: true});
        this._list = new St.BoxLayout({vertical: true, x_expand: true});
        this._scroll = new St.ScrollView({
            overlay_scrollbars: true, x_expand: true, y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        this._scroll.set_child(this._list);
        this.actor.add_child(this._entry);
        this.actor.add_child(this._scroll);
        this._apps = Shell.AppSystem.get_default().get_installed()
            .filter(a => a.should_show())
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));
        this._entry.clutter_text.connect('text-changed', () => this._filter());
        this._entry.clutter_text.connect('activate', () => {
            if (this._results[0])
                this._launch(this._results[0]);
        });
        this._filter();
    }

    focus() { this._entry.grab_key_focus(); }

    _score(app, q) {
        const name = app.get_name().toLowerCase();
        if (name.startsWith(q))
            return 0;
        if (name.includes(q))
            return 1;
        const extra = `${app.get_generic_name() ?? ''} ${app.get_keywords?.()?.join(' ') ?? ''} ${app.get_description() ?? ''}`.toLowerCase();
        return extra.includes(q) ? 2 : -1;
    }

    _filter() {
        const q = this._entry.get_text().trim().toLowerCase();
        let res;
        if (!q) {
            res = this._apps.slice(0, 40);
        } else {
            res = this._apps.map(a => [a, this._score(a, q)]).filter(([, s]) => s >= 0)
                .sort((x, y) => x[1] - y[1]).map(([a]) => a).slice(0, 40);
        }
        this._results = res;
        this._list.destroy_all_children();
        for (const app of res) {
            const b = new St.Button({style_class: 'minie-app-row', can_focus: true, reactive: true, track_hover: true, x_expand: true, x_align: Clutter.ActorAlign.FILL});
            const box = new St.BoxLayout({x_expand: true});
            box.add_child(new St.Icon({gicon: app.get_icon(), icon_size: 28, y_align: Clutter.ActorAlign.CENTER}));
            const col = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER, x_expand: true});
            col.add_child(makeLabel(app.get_name(), 'minie-title'));
            const desc = app.get_description();
            if (desc)
                col.add_child(makeLabel(desc, 'minie-sub'));
            box.add_child(col);
            b.set_child(box);
            b.connect('clicked', () => this._launch(app));
            this._list.add_child(b);
        }
    }

    _launch(app) {
        try {
            app.launch([], global.create_app_launch_context(0, -1));
        } catch (e) {
            console.warn(`minie-pill: launch failed: ${e.message}`);
        }
        this._ctx.close();
    }

    destroy() { this.actor.destroy(); }
}

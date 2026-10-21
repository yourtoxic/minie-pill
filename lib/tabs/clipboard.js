import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {makeButton, makeLabel} from '../util.js';

export class ClipboardTab {
    constructor(ctx) {
        this._ctx = ctx;
        this._svc = ctx.svc('clipboard');
        this.actor = new St.BoxLayout({vertical: true, style_class: 'minie-tab', x_expand: true, y_expand: true});
        const head = new St.BoxLayout({style_class: 'minie-row', x_expand: true});
        head.add_child(new St.Label({text: 'Clipboard history', style_class: 'minie-big-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        head.add_child(makeButton('user-trash-symbolic', () => this._svc.clear()));
        this.actor.add_child(head);
        this._list = new St.BoxLayout({vertical: true, x_expand: true});
        const scroll = new St.ScrollView({
            overlay_scrollbars: true, x_expand: true, y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        scroll.set_child(this._list);
        this.actor.add_child(scroll);
        this._unsub = this._svc.onChanged(() => this._render());
        this._render();
    }

    _render() {
        this._list.destroy_all_children();
        const items = this._svc.sorted();
        if (!items.length) {
            const l = new St.Label({text: 'Nothing copied yet', style_class: 'minie-sub', x_align: Clutter.ActorAlign.CENTER});
            l.set_style('margin-top: 40px;');
            this._list.add_child(l);
            return;
        }
        for (const item of items) {
            const row = new St.BoxLayout({style_class: 'minie-app-row', x_expand: true});
            const main = new St.Button({style_class: 'minie-clip-main', can_focus: true, reactive: true, track_hover: true, x_expand: true, x_align: Clutter.ActorAlign.FILL});
            const text = item.text.replace(/\s+/g, ' ').trim();
            main.set_child(makeLabel(text.length > 140 ? `${text.slice(0, 140)}…` : text, 'minie-text'));
            main.connect('clicked', () => {
                this._svc.copy(item.text);
                this._ctx.close();
            });
            row.add_child(main);
            row.add_child(makeButton(item.pinned ? 'starred-symbolic' : 'non-starred-symbolic', () => this._svc.togglePin(item), 14));
            row.add_child(makeButton('window-close-symbolic', () => this._svc.remove(item), 14));
            this._list.add_child(row);
        }
    }

    destroy() {
        this._unsub?.();
        this.actor.destroy();
    }
}

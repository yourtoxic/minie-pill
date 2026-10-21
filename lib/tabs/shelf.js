import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import {makeButton, makeLabel} from '../util.js';

export class ShelfTab {
    constructor(ctx) {
        this._ctx = ctx;
        this._svc = ctx.svc('shelf');
        this.actor = new St.BoxLayout({vertical: true, style_class: 'minie-tab', x_expand: true, y_expand: true});
        const head = new St.BoxLayout({style_class: 'minie-row', x_expand: true});
        head.add_child(new St.Label({text: 'File shelf', style_class: 'minie-big-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        const add = new St.Button({label: 'Paste files', style_class: 'minie-pillbtn', can_focus: true, reactive: true, track_hover: true});
        add.connect('clicked', () => this._svc.addFromClipboard(n => {
            this._hint.text = n ? `Added ${n} file(s)` : 'Copy files in the file manager first (Ctrl+C)';
        }));
        head.add_child(add);
        head.add_child(makeButton('user-trash-symbolic', () => this._svc.clear()));
        this.actor.add_child(head);
        this._hint = new St.Label({text: 'Copy files in the file manager, then press “Paste files”.', style_class: 'minie-sub'});
        this._hint.set_style('margin-bottom: 8px;');
        this.actor.add_child(this._hint);
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
        for (const uri of this._svc.uris) {
            const file = Gio.File.new_for_uri(uri);
            let icon = null;
            try {
                icon = file.query_info('standard::icon', Gio.FileQueryInfoFlags.NONE, null).get_icon();
            } catch (_e) { icon = null; }
            const row = new St.BoxLayout({style_class: 'minie-app-row', x_expand: true});
            const main = new St.Button({style_class: 'minie-clip-main', can_focus: true, reactive: true, track_hover: true, x_expand: true, x_align: Clutter.ActorAlign.FILL});
            const inner = new St.BoxLayout({x_expand: true});
            const ic = new St.Icon({icon_size: 24, y_align: Clutter.ActorAlign.CENTER});
            if (icon)
                ic.gicon = icon;
            else
                ic.icon_name = 'text-x-generic-symbolic';
            inner.add_child(ic);
            inner.add_child(makeLabel(file.get_basename() ?? uri, 'minie-text'));
            main.set_child(inner);
            main.connect('clicked', () => this._svc.open(uri));
            row.add_child(main);
            row.add_child(makeButton('edit-copy-symbolic', () => {
                this._svc.copyToClipboard(uri);
                this._hint.text = 'Copied — paste it into a folder (Ctrl+V)';
            }, 14));
            row.add_child(makeButton('window-close-symbolic', () => this._svc.remove(uri), 14));
            this._list.add_child(row);
        }
    }

    destroy() {
        this._unsub?.();
        this.actor.destroy();
    }
}

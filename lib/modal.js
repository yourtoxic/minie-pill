import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import Graphene from 'gi://Graphene';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {SpringGroup} from './spring.js';

// Full-screen click catcher + modal grab hosting one popup child under the pill.
// Opens by springing out of the pill's size; any click outside the child closes it.
export class ModalHost {
    constructor(getSpringParams, durationFn, onClosed) {
        this._params = getSpringParams;
        this._d = durationFn;
        this._onClosed = onClosed;
        this._root = null;
        this._child = null;
        this._grab = null;
        this._sp = null;
        this._from = [0.3, 0.1];
    }

    get isOpen() { return !!this._root; }
    get child() { return this._child; }

    open(child, topOffset, from = null) {
        if (this._root)
            return false;
        const root = new St.Widget({reactive: true, layout_manager: new Clutter.BinLayout()});
        root.add_constraint(new Clutter.BindConstraint({
            source: global.stage, coordinate: Clutter.BindCoordinate.ALL, offset: 0,
        }));
        child.set({
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.START,
            x_expand: true, y_expand: true, margin_top: topOffset, reactive: true,
            pivot_point: new Graphene.Point({x: 0.5, y: 0}),
        });
        root.add_child(child);
        Main.layoutManager.modalDialogGroup.add_child(root);

        const grab = Main.pushModal(root, {actionMode: Shell.ActionMode.POPUP});
        if (!grab || (grab.get_seat_state && grab.get_seat_state() !== Clutter.GrabState.ALL)) {
            if (grab)
                Main.popModal(grab);
            root.destroy();
            return false;
        }
        this._grab = grab;
        this._root = root;
        this._child = child;

        // outside click closes (geometry test, independent of picking)
        root.connect('captured-event', (_a, ev) => {
            const t = ev.type();
            if (t !== Clutter.EventType.BUTTON_PRESS && t !== Clutter.EventType.TOUCH_BEGIN)
                return Clutter.EVENT_PROPAGATE;
            if (!this._child)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = ev.get_coords();
            const [cx, cy] = this._child.get_transformed_position();
            const [cw, ch] = this._child.get_transformed_size();
            if (x < cx || y < cy || x > cx + cw || y > cy + ch) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        root.connect('key-press-event', (_a, ev) => {
            if (ev.get_key_symbol() === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // spring from pill size -> full size
        const w = child.get_preferred_width(-1)[1] || 1;
        const [, hh] = child.get_preferred_height(w);
        const sx0 = from ? Math.max(0.15, Math.min(1, from.width / Math.max(1, w))) : 0.5;
        const sy0 = from ? Math.max(0.05, Math.min(1, from.height / Math.max(1, hh))) : 0.5;
        this._from = [sx0, sy0];
        const sp = new SpringGroup(this._params, () => {
            try {
                child.scale_x = sp.get('sx');
                child.scale_y = sp.get('sy');
            } catch (_e) { /* child already destroyed */ }
        });
        sp.add('sx', sx0, 0.002);
        sp.add('sy', sy0, 0.002);
        this._sp = sp;
        child.set({opacity: 0, scale_x: sx0, scale_y: sy0, translation_y: -6});
        child.ease({opacity: 255, translation_y: 0, duration: this._d(150), mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        sp.setTarget('sx', 1);
        sp.setTarget('sy', 1);
        root.grab_key_focus();
        return true;
    }

    close() {
        if (!this._root)
            return;
        const root = this._root, child = this._child, grab = this._grab, sp = this._sp;
        const [sx0, sy0] = this._from;
        this._root = null;
        this._child = null;
        this._grab = null;
        this._sp = null;
        root.reactive = false;
        if (grab)
            Main.popModal(grab);
        sp.setTarget('sx', Math.min(1, sx0 + 0.1));
        sp.setTarget('sy', Math.min(1, sy0 + 0.05));
        child.ease({
            opacity: 0, duration: this._d(170), mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                sp.destroy();
                root.destroy();
            },
        });
        this._onClosed?.();
    }

    destroy() {
        if (!this._root)
            return;
        const root = this._root, grab = this._grab;
        this._sp?.destroy();
        this._root = null;
        this._child = null;
        this._grab = null;
        this._sp = null;
        if (grab)
            Main.popModal(grab);
        root.destroy();
        this._onClosed?.();
    }
}

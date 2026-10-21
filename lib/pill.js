import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {IdleActivity} from './activities.js';
import {SpringGroup, springParams} from './spring.js';
import {SquircleBg, parseColor} from './squircle.js';
import {padXFor, makeIcon} from './util.js';

const QUAD = Clutter.AnimationMode.EASE_OUT_QUAD;
const EXPO = Clutter.AnimationMode.EASE_OUT_EXPO;
const BADGE_ORDER = ['airplane', 'caffeine', 'dnd'];

export class Pill {
    constructor(settings, manager, {onClick, onVolumeScroll, onMiddleClick}) {
        this._s = settings;
        this._m = manager;
        this._onClick = onClick;
        this._onVolumeScroll = onVolumeScroll;
        this._onMiddle = onMiddleClick;
        this._idle = new IdleActivity();
        this._shown = null;
        this._visible = false;
        this._sized = false;
        this._token = 0;
        this._acc = 0;
        this._lastScroll = 0;
        this._badges = new Map();
        this._hiddenByPanel = false;
        this._micActive = false;
        this._unsub = null;
        this.actor = null;
    }

    d(ms) {
        return Math.round(ms * 100 / Math.max(10, this._s.get_int('animation-speed')));
    }

    enable() {
        this.actor = new St.Button({
            style_class: 'minie-pill', reactive: true, can_focus: false, track_hover: true,
            visible: false, opacity: 0, clip_to_allocation: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
        });
        const shell = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
        this._shell = shell;
        this._bg = new SquircleBg();
        this._row = new St.BoxLayout({x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.FILL, y_align: Clutter.ActorAlign.FILL});
        this._badgeBox = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER, style_class: 'minie-badges'});
        this._badgeBox.hide();
        this._content = new St.Bin({
            x_expand: true, y_expand: true,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
        });
        this._row.add_child(this._badgeBox);
        this._row.add_child(this._content);
        shell.add_child(this._bg.actor);
        shell.add_child(this._row);
        // iOS-style status dot: click it to hop left -> middle -> right
        this._dot = new St.Button({style_class: 'minie-dot-btn', reactive: true, can_focus: false, track_hover: true, visible: false});
        this._dotCore = new St.Widget({style_class: 'minie-dot'});
        this._dot.set_child(this._dotCore);
        this._dot.connect('clicked', () => this._cycleDot());
        shell.add_child(this._dot);
        this.actor.set_child(shell);

        this._sp = new SpringGroup(() => springParams(this._s), () => this._applySize());
        this._sp.add('w', 80);
        this._sp.add('h', this._s.get_int('pill-height'));

        try {
            Main.layoutManager.addTopChrome(this.actor, {trackFullscreen: true});
        } catch (_e) {
            Main.layoutManager.addTopChrome(this.actor);
        }
        this.actor.connect('clicked', (_a, button) => {
            if (button === 3)
                this._m.cycle(1);
            else if (button === 2)
                this._onMiddle?.(this._shown);
            else
                this._onClick(this._shown);
        });
        this.actor.connect('scroll-event', (_a, ev) => this._scroll(ev));
        this._monId = Main.layoutManager.connect('monitors-changed', () => this._applySize());
        this._unsub = this._m.onChange((act, info) => this.show(act, info.resize));
        this.restyle();
        this.show(this._m.resolve(), false);
    }

    // y of the pill's bottom edge (panel anchors below it)
    get bottom() {
        return this._s.get_int('pill-top-margin') + Math.round(this._sp?.get('h') ?? this._s.get_int('pill-height'));
    }

    get top() { return this._s.get_int('pill-top-margin'); }
    get width() { return this.actor ? this.actor.width : 0; }
    get height() { return this.actor ? this.actor.height : 0; }

    // ---------- badges (DND / caffeine / airplane)
    setBadge(id, icon) {
        const cur = this._badges.get(id);
        if (!icon) {
            if (!cur)
                return;
            cur.destroy();
            this._badges.delete(id);
        } else if (!cur) {
            const w = makeIcon(icon, 14, 'minie-badge');
            this._badges.set(id, w);
            const idx = BADGE_ORDER.indexOf(id);
            let pos = 0;
            for (const k of BADGE_ORDER.slice(0, idx))
                if (this._badges.has(k))
                    pos++;
            this._badgeBox.insert_child_at_index(w, pos);
        }
        this._badgeBox.visible = this._badges.size > 0;
        this._retarget(true);
    }

    // ---------- style
    restyle() {
        if (!this.actor)
            return;
        const s = this._s;
        this.actor.set_style(`color: ${s.get_string('text-color')}; font-size: ${s.get_int('font-size')}px;`);
        const border = s.get_boolean('border-enabled');
        this._bg.set({
            fill: parseColor(s.get_string('bg-color')),
            stroke: border ? parseColor(s.get_string('border-color'), [1, 1, 1, 0.5]) : null,
            lineWidth: s.get_int('border-width'),
            n: 2 + s.get_int('corner-smoothing') / 100 * 2.4,
        });
        this._styleDot();
        this._content.set({translation_x: s.get_int('content-offset-x'), translation_y: s.get_int('content-offset-y')});
        this._retarget(this._sized);
    }

    refresh() {
        this.show(this._m.resolve(), true);
    }

    _heightFor(act) {
        const h = act?.height;
        return h ? h : this._s.get_int('pill-height');
    }

    _radiusFor(h) {
        const compact = this._s.get_int('pill-height') / 2;
        const full = Math.min(h / 2, Math.max(compact, 34));
        return full * this._s.get_int('pill-roundness') / 100;
    }

    _dotVisible() {
        const mode = this._s.get_string('dot-mode');
        return mode === 'always' || (mode === 'mic' && this._micActive);
    }

    // left/right dot lives INSIDE the row, so it is always vertically centred and never overlaps content
    _dotInRow() {
        const pos = this._s.get_string('dot-position');
        return pos === 'left' || pos === 'right';
    }

    _styleRow(h) {
        const px = padXFor(h);
        let l = px, r = px;
        if (this._dotVisible() && this._dotInRow()) {
            // the dot button has 4px padding of its own, so the visible dot sits `dot-inset` px from the edge
            const pad = Math.max(4, this._s.get_int('dot-inset') - 4);
            if (this._s.get_string('dot-position') === 'left')
                l = pad;
            else
                r = pad;
        }
        this._row.set_style(`padding: 0 ${r}px 0 ${l}px; spacing: 8px;`);
    }

    setMicActive(on) {
        if (this._micActive === on)
            return;
        this._micActive = on;
        this._styleDot();
        this._retarget(true);
    }

    _cycleDot() {
        const order = ['left', 'middle', 'right'];
        const cur = this._s.get_string('dot-position');
        const i = order.indexOf(cur);
        this._s.set_string('dot-position', order[(i + 1) % order.length]);
    }

    _placeDot(parent) {
        const cur = this._dot.get_parent();
        if (cur !== parent) {
            cur?.remove_child(this._dot);
            parent.add_child(this._dot);
        }
    }

    _styleDot() {
        if (!this._dot)
            return;
        const s = this._s;
        const size = s.get_int('dot-size');
        const color = s.get_string('dot-color');
        this._dot.visible = this._dotVisible();
        this._dotCore.set_size(size, size);
        this._dotCore.set_style(`background-color: ${color}; border-radius: ${size}px; box-shadow: 0 0 ${Math.round(size * 0.9)}px ${color};`);
        const pos = s.get_string('dot-position');
        const reset = {
            margin_left: 0, margin_right: 0, margin_top: 0, margin_bottom: 0,
            translation_x: 0, translation_y: 0,
        };
        if (pos === 'left' || pos === 'right') {
            this._placeDot(this._row);
            this._row.set_child_at_index(this._dot, pos === 'left' ? 0 : -1);
            this._dot.set({...reset, x_expand: false, y_expand: false, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
            return;
        }
        this._placeDot(this._shell);
        this._dot.set({...reset, x_expand: true, y_expand: true});
        if (pos === 'middle') {
            this._dot.set({x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.START});
        } else {
            this._dot.set({
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
                translation_x: s.get_int('dot-offset-x'), translation_y: s.get_int('dot-offset-y'),
            });
        }
    }

    // hide the pill while the popup is open (the popup grows out of it)
    setHidden(hidden) {
        this._hiddenByPanel = hidden;
        if (!this.actor || !this._visible)
            return;
        this.actor.reactive = !hidden;
        this.actor.remove_transition('opacity');
        this.actor.ease({opacity: hidden ? 0 : 255, duration: this.d(hidden ? 110 : 220), mode: QUAD});
    }

    _applySize() {
        if (!this.actor)
            return;
        const w = Math.max(24, Math.round(this._sp.get('w') / 2) * 2);
        const h = Math.max(16, Math.round(this._sp.get('h') / 2) * 2);
        this.actor.set_size(w, h);
        const mon = Main.layoutManager.primaryMonitor;
        this.actor.set_position(mon.x + Math.round((mon.width - w) / 2), mon.y + this._s.get_int('pill-top-margin'));
        this._bg.set({radius: this._radiusFor(h)});
    }

    // measure shown content and aim the springs at the new size
    _retarget(animate = true) {
        if (!this.actor || !this._visible)
            return;
        const act = this._shown;
        const h = this._heightFor(act);
        this._styleRow(h);
        let w;
        const natural = this._row.get_preferred_width(-1)[1];
        if (!act?.width && this._s.get_string('width-mode') === 'fixed')
            w = this._s.get_int('fixed-width');
        else
            w = natural + 2;
        w = Math.max(w, 64);
        if (!animate) {
            this._sp.jump('w', w);
            this._sp.jump('h', h);
            this._applySize();
        } else {
            this._sp.setTarget('w', w);
            this._sp.setTarget('h', h);
        }
        this._sized = true;
    }

    show(activity, forceResize = false) {
        if (!this.actor)
            return;
        const target = activity ?? (this._s.get_boolean('always-visible') ? this._idle : null);
        if (!target) {
            this._hide();
            return;
        }
        if (target === this._shown && this._visible) {
            if (forceResize)
                this._retarget(true);
            return;
        }
        const wasVisible = this._visible;
        const prev = this._shown;
        this._shown = target;
        prev?.onHidden();
        const actor = target.ensureActor();
        this._reveal();
        this._swap(actor, wasVisible);
        target.onShown();
    }

    _reveal() {
        if (this._visible)
            return;
        this._visible = true;
        this._sized = false;
        this.actor.remove_all_transitions();
        this.actor.show();
        this.actor.reactive = !this._hiddenByPanel;
        this.actor.set({opacity: 0, translation_y: -14});
        this.actor.ease({opacity: this._hiddenByPanel ? 0 : 255, translation_y: 0, duration: this.d(240), mode: EXPO});
    }

    _hide() {
        this._shown?.onHidden();
        this._shown = null;
        if (!this._visible)
            return;
        this._visible = false;
        this.actor.reactive = false;
        this.actor.remove_all_transitions();
        this.actor.ease({
            opacity: 0, translation_y: -14, duration: this.d(200), mode: QUAD,
            onComplete: () => {
                if (!this._visible)
                    this.actor.hide();
            },
        });
    }

    // fade old content out -> swap + spring-resize -> fade new content in
    _swap(actor, animate) {
        const token = ++this._token;
        const place = () => {
            if (token !== this._token || !this.actor)
                return;
            if (this._content.get_child() !== actor) {
                actor.get_parent()?.remove_child(actor);
                this._content.set_child(actor);
            }
            this._retarget(this._sized);
            this._content.ease({opacity: 255, duration: this.d(170), delay: this.d(50), mode: QUAD});
        };
        this._content.remove_all_transitions();
        if (!animate || !this._content.get_child()) {
            this._content.opacity = 0;
            place();
            return;
        }
        this._content.ease({opacity: 0, duration: this.d(70), mode: QUAD, onComplete: place});
    }

    // ---------- input
    _scroll(ev) {
        const dir = ev.get_scroll_direction();
        let amount = 0;
        if (dir === Clutter.ScrollDirection.UP)
            amount = -1;
        else if (dir === Clutter.ScrollDirection.DOWN)
            amount = 1;
        else if (dir === Clutter.ScrollDirection.SMOOTH)
            amount = Math.max(-3, Math.min(3, ev.get_scroll_delta()[1]));
        else
            return Clutter.EVENT_PROPAGATE;
        if (amount === 0)
            return Clutter.EVENT_STOP;

        const shift = (ev.get_state() & Clutter.ModifierType.SHIFT_MASK) !== 0;
        const now = GLib.get_monotonic_time() / 1000;
        if (this._shown?.scrollVolume?.() && !shift) {
            if (now - this._lastScroll < 25)
                return Clutter.EVENT_STOP;
            this._lastScroll = now;
            this._onVolumeScroll(amount);
            return Clutter.EVENT_STOP;
        }
        if (!this._s.get_boolean('scroll-switch') && !shift)
            return Clutter.EVENT_PROPAGATE;
        this._acc += amount;
        if (Math.abs(this._acc) < 1)
            return Clutter.EVENT_STOP;
        const step = Math.sign(this._acc);
        this._acc = 0;
        if (now - this._lastScroll < 200)
            return Clutter.EVENT_STOP;
        this._lastScroll = now;
        this._m.cycle(step);
        return Clutter.EVENT_STOP;
    }

    destroy() {
        this._unsub?.();
        this._sp?.destroy();
        this._content?.set_child(null);
        if (this._monId)
            Main.layoutManager.disconnect(this._monId);
        this._shown?.onHidden();
        this._idle.destroy();
        if (this.actor) {
            Main.layoutManager.removeChrome(this.actor);
            this.actor.destroy();
            this.actor = null;
        }
    }
}

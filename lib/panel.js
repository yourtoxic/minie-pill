import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {ModalHost} from './modal.js';
import {makeIcon} from './util.js';
import {squircleShell} from './squircle.js';
import {springParams} from './spring.js';
import {HomeTab} from './tabs/home.js';
import {CalendarTab} from './tabs/calendar.js';
import {WeatherTab} from './tabs/weather.js';
import {LauncherTab} from './tabs/launcher.js';
import {ClipboardTab} from './tabs/clipboard.js';
import {ShelfTab} from './tabs/shelf.js';
import {ControlsTab} from './tabs/controls.js';
import {TimerTab} from './tabs/timer.js';

const TABS = [
    {id: 'home', icon: 'audio-x-generic-symbolic', cls: HomeTab},
    {id: 'calendar', icon: 'x-office-calendar-symbolic', cls: CalendarTab},
    {id: 'weather', icon: 'weather-clear-symbolic', cls: WeatherTab},
    {id: 'apps', icon: 'view-app-grid-symbolic', cls: LauncherTab},
    {id: 'clipboard', icon: 'edit-paste-symbolic', cls: ClipboardTab, needs: 'clipboard-enabled'},
    {id: 'shelf', icon: 'folder-symbolic', cls: ShelfTab},
    {id: 'controls', icon: 'emblem-system-symbolic', cls: ControlsTab},
    {id: 'timer', icon: 'alarm-symbolic', cls: TimerTab},
];

export class IslandPanel {
    constructor(ctx) {
        this._ctx = ctx;   // see controller._ctx()
        this._host = new ModalHost(() => springParams(ctx.settings), ms => ctx.d(ms), () => this._teardown());
        this._tab = null;
        this._tabId = null;
        this._buttons = new Map();
    }

    get isOpen() { return this._host.isOpen; }

    open(tabId = 'home') {
        if (this._host.isOpen) {
            this._select(tabId);
            return;
        }
        const s = this._ctx.settings;
        this._inner = new St.BoxLayout({vertical: true, style_class: 'minie-panel'});
        this._panel = squircleShell(s, this._inner, 30);
        this._panel.set_width(s.get_int('panel-width'));
        const tabs = new St.BoxLayout({style_class: 'minie-tabs', x_align: Clutter.ActorAlign.CENTER});
        this._buttons.clear();
        for (const t of TABS) {
            if (t.needs && !s.get_boolean(t.needs))
                continue;
            const b = new St.Button({
                style_class: 'minie-tab-btn', can_focus: true, reactive: true, track_hover: true,
                child: makeIcon(t.icon, 18),
            });
            b.connect('clicked', () => this._select(t.id));
            this._buttons.set(t.id, b);
            tabs.add_child(b);
        }
        this._body = new St.Bin({style_class: 'minie-body', x_expand: true, y_expand: true});
        this._body.set_height(s.get_int('panel-height'));
        const header = tabs;
        this._inner.add_child(header);
        // Ctrl + scroll over the popup resizes it
        this._panel.connect('scroll-event', (_a, ev) => {
            if (!(ev.get_state() & Clutter.ModifierType.CONTROL_MASK))
                return Clutter.EVENT_PROPAGATE;
            const d = ev.get_scroll_direction();
            if (d === Clutter.ScrollDirection.UP)
                this._resize(1);
            else if (d === Clutter.ScrollDirection.DOWN)
                this._resize(-1);
            else if (d === Clutter.ScrollDirection.SMOOTH)
                this._resize(ev.get_scroll_delta()[1] < 0 ? 1 : -1);
            return Clutter.EVENT_STOP;
        });
        this._inner.add_child(this._body);
        const ok = this._host.open(this._panel, this._ctx.pillTop(), this._ctx.pillSize());
        if (!ok) {
            this._panel.destroy();
            this._panel = null;
            return;
        }
        this._ctx.pillHide(true);
        this._select(this._buttons.has(tabId) ? tabId : 'home');
    }

    // + / - buttons: grow or shrink the popup by 6 percent steps
    _resize(dir) {
        const s = this._ctx.settings;
        const w = Math.max(360, Math.min(900, Math.round(s.get_int('panel-width') * (1 + 0.06 * dir))));
        const h = Math.max(240, Math.min(760, Math.round(s.get_int('panel-height') * (1 + 0.06 * dir))));
        s.set_int('panel-width', w);
        s.set_int('panel-height', h);
        this._panel?.set_width(w);
        this._body?.set_height(h);
    }

    toggle(tabId) {
        if (this._host.isOpen)
            this.close();
        else
            this.open(tabId);
    }

    close() { this._host.close(); }

    _select(id) {
        if (!this._panel || !this._buttons.has(id))
            return;
        if (this._tabId === id && this._tab)
            return;
        this._tab?.destroy();
        this._tab = null;
        this._tabId = id;
        for (const [tid, b] of this._buttons) {
            if (tid === id)
                b.add_style_pseudo_class('active');
            else
                b.remove_style_pseudo_class('active');
        }
        const def = TABS.find(t => t.id === id);
        this._tab = new def.cls(this._ctx);
        this._body.set_child(this._tab.actor);
        this._tab.focus?.();
    }

    _teardown() {
        this._ctx.pillHide(false);
        this._tab?.destroy();
        this._tab = null;
        this._tabId = null;
        this._panel = null;
        this._buttons.clear();
    }

    destroy() {
        this._host.destroy();
        this._teardown();
    }
}

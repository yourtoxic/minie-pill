import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {makeButton, formatDuration} from '../util.js';

export class TimerTab {
    constructor(ctx) {
        this._ctx = ctx;
        this._t = ctx.svc('timer');
        this._minutes = ctx.settings.get_int('timer-minutes');
        this.actor = new St.BoxLayout({vertical: true, style_class: 'minie-tab', x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._unsub = this._t.onChanged(what => what === 'tick' ? this._tick() : this._render());
        this._render();
    }

    _tick() {
        if (this._time)
            this._time.text = formatDuration(this._t.remaining);
    }

    _render() {
        this.actor.destroy_all_children();
        const t = this._t;
        this._time = new St.Label({
            text: t.state === 'idle' ? formatDuration(this._minutes * 60) : formatDuration(t.remaining),
            style_class: 'minie-huge', x_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(this._time);
        if (t.state === 'finished')
            this.actor.add_child(new St.Label({text: "Time's up", style_class: 'minie-sub', x_align: Clutter.ActorAlign.CENTER}));

        if (t.state === 'idle' || t.state === 'finished') {
            const adj = new St.BoxLayout({style_class: 'minie-controls', x_align: Clutter.ActorAlign.CENTER});
            adj.add_child(makeButton('list-remove-symbolic', () => this._adjust(-1), 18));
            for (const m of [1, 5, 10, 15, 25, 45]) {
                const b = new St.Button({label: `${m}m`, style_class: 'minie-pillbtn', can_focus: true, reactive: true, track_hover: true});
                b.connect('clicked', () => { this._minutes = m; this._render(); });
                adj.add_child(b);
            }
            adj.add_child(makeButton('list-add-symbolic', () => this._adjust(1), 18));
            this.actor.add_child(adj);
            const go = new St.Button({label: 'Start', style_class: 'minie-pillbtn minie-pillbtn-main', can_focus: true, reactive: true, track_hover: true, x_align: Clutter.ActorAlign.CENTER});
            go.set_style(`background-color: ${this._ctx.settings.get_string('accent-color')}; color: #000;`);
            go.connect('clicked', () => t.begin(this._minutes * 60));
            this.actor.add_child(go);
        } else {
            const ctl = new St.BoxLayout({style_class: 'minie-controls', x_align: Clutter.ActorAlign.CENTER});
            ctl.add_child(makeButton(t.state === 'running' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
                () => (t.state === 'running' ? t.pause() : t.resume()), 24, 'minie-btn minie-btn-lg minie-btn-main'));
            ctl.add_child(makeButton('media-playback-stop-symbolic', () => t.reset(), 24, 'minie-btn minie-btn-lg'));
            this.actor.add_child(ctl);
        }
    }

    _adjust(d) {
        this._minutes = Math.max(1, Math.min(600, this._minutes + d));
        this._ctx.settings.set_int('timer-minutes', this._minutes);
        this._render();
    }

    destroy() {
        this._unsub?.();
        this.actor.destroy();
    }
}

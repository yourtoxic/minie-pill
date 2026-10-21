import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {makeIcon, makeButton} from '../util.js';

export class ControlsTab {
    constructor(ctx) {
        this._ctx = ctx;
        this._unsubs = [];
        this._updaters = [];
        this._ignore = false;
        this._sys = ctx.svc('system');
        this.actor = new St.BoxLayout({vertical: true, style_class: 'minie-tab', x_expand: true, y_expand: true});

        this._volRow = this._sliderRow('audio-volume-high-symbolic',
            v => this._sys.setVolume(v), () => this._sys.toggleMute());
        this._briRow = this._sliderRow('display-brightness-symbolic', v => this._sys.setBrightness(v), null);
        this.actor.add_child(this._volRow.box);
        this.actor.add_child(this._briRow.box);

        const grid = new St.BoxLayout({vertical: true, x_expand: true});
        grid.set_style('margin-top: 10px;');
        const r1 = new St.BoxLayout({x_expand: true, style_class: 'minie-row'});
        const r2 = new St.BoxLayout({x_expand: true, style_class: 'minie-row'});
        const r3 = new St.BoxLayout({x_expand: true, style_class: 'minie-row'});
        r1.add_child(this._toggle('network-wireless-symbolic', 'Wi-Fi',
            () => this._net()?.enabled ?? false, v => this._net()?.setEnabled(v)));
        r1.add_child(this._toggle('bluetooth-active-symbolic', 'Bluetooth',
            () => this._bt()?.powered ?? false, v => this._bt()?.setPowered(v)));
        r1.add_child(this._toggle('notifications-disabled-symbolic', 'Do Not Disturb',
            () => this._sys.dnd, v => this._sys.setDnd(v)));
        if (this._sys.nightAvailable) {
            r2.add_child(this._toggle('night-light-symbolic', 'Night Light',
                () => this._sys.nightLight, v => this._sys.setNightLight(v)));
        }
        r2.add_child(this._toggle('weather-clear-night-symbolic', 'Dark style',
            () => this._sys.dark, v => this._sys.setDark(v)));
        r2.add_child(this._toggle('airplane-mode-symbolic', 'Airplane mode',
            () => this._ctx.airplane.get(), v => this._ctx.airplane.set(v)));
        r2.add_child(this._toggle(this._ctx.icon('caffeine'), 'Caffeine',
            () => this._sys.caffeine, v => this._sys.setCaffeine(v)));
        r3.add_child(this._action('system-lock-screen-symbolic', 'Lock', () => {
            this._ctx.close();
            Main.screenShield.lock(true);
        }));
        r3.add_child(this._action('emblem-system-symbolic', 'Pill settings', () => {
            this._ctx.close();
            this._ctx.ext.openPreferences();
        }));
        grid.add_child(r1);
        grid.add_child(r2);
        grid.add_child(r3);
        this.actor.add_child(grid);

        this._unsubs.push(this._sys.onChanged(() => this._refresh()));
        const net = this._net(), bt = this._bt();
        if (net) this._unsubs.push(net.onChanged(() => this._refresh()));
        if (bt) this._unsubs.push(bt.onChanged(() => this._refresh()));
        this._refresh();
    }


    _net() { return this._ctx.svc('network'); }
    _bt() { return this._ctx.svc('bluetooth'); }

    _sliderRow(iconName, onValue, onIcon) {
        const box = new St.BoxLayout({style_class: 'minie-row minie-card', x_expand: true});
        const icon = onIcon
            ? makeButton(iconName, onIcon, 18)
            : new St.Button({style_class: 'minie-btn', child: makeIcon(iconName, 18)});
        const slider = new Slider(0);
        slider.x_expand = true;
        slider.y_align = Clutter.ActorAlign.CENTER;
        const pct = new St.Label({text: '0%', style_class: 'minie-sub', y_align: Clutter.ActorAlign.CENTER});
        pct.set_width(44);
        slider.connect('notify::value', () => {
            if (this._ignore)
                return;
            onValue(slider.value);
        });
        box.add_child(icon);
        box.add_child(slider);
        box.add_child(pct);
        return {box, slider, pct, icon};
    }

    _toggle(iconName, label, getState, setState) {
        const b = new St.Button({style_class: 'minie-toggle', can_focus: true, reactive: true, track_hover: true, x_expand: true, x_align: Clutter.ActorAlign.FILL});
        const inner = new St.BoxLayout({vertical: true});
        const ic = makeIcon(iconName, 20);
        ic.x_align = Clutter.ActorAlign.CENTER;
        inner.add_child(ic);
        inner.add_child(new St.Label({text: label, style_class: 'minie-toggle-label', x_align: Clutter.ActorAlign.CENTER}));
        b.set_child(inner);
        b.connect('clicked', () => setState(!getState()));
        this._updaters.push(() => {
            if (getState()) {
                b.add_style_pseudo_class('active');
                b.set_style(`background-color: ${this._ctx.settings.get_string('accent-color')}; color: #000;`);
            } else {
                b.remove_style_pseudo_class('active');
                b.set_style('');
            }
        });
        return b;
    }

    _action(iconName, label, cb) {
        const b = new St.Button({style_class: 'minie-toggle', can_focus: true, reactive: true, track_hover: true, x_expand: true, x_align: Clutter.ActorAlign.FILL});
        const inner = new St.BoxLayout({vertical: true});
        const ic = makeIcon(iconName, 20);
        ic.x_align = Clutter.ActorAlign.CENTER;
        inner.add_child(ic);
        inner.add_child(new St.Label({text: label, style_class: 'minie-toggle-label', x_align: Clutter.ActorAlign.CENTER}));
        b.set_child(inner);
        b.connect('clicked', cb);
        return b;
    }

    _refresh() {
        this._ignore = true;
        const s = this._sys;
        this._volRow.box.visible = s.volumeAvailable;
        this._volRow.slider.value = Math.min(1, s.volume);
        this._volRow.pct.text = `${Math.round(s.volume * 100)}%`;
        this._volRow.icon.child.icon_name = s.muted || s.volume === 0 ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic';
        this._briRow.box.visible = s.brightnessAvailable;
        this._briRow.slider.value = s.brightness;
        this._briRow.pct.text = `${Math.round(s.brightness * 100)}%`;
        this._ignore = false;
        for (const u of this._updaters)
            u();
    }

    destroy() {
        this.actor.destroy();
    }
}

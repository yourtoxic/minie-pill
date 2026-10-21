import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import {makeLabel, makeIcon, formatDuration, padXFor} from './util.js';
import {describeWeather} from './weathercodes.js';
import {BatteryGlyph} from './battery.js';
import {catSprite, CAT_STYLES, CAT_EFFECTS, drawDots, drawEffect, monotonicSeconds} from './cat.js';
import {formatBytes} from './services/downloads.js';
import {lineAt} from './lrc.js';
import {pathToStyle} from './services/art.js';
import {signalIcon} from './services/network.js';
import {BluetoothService} from './services/bluetooth.js';

const CENTER = Clutter.ActorAlign.CENTER;

export class Activity {
    constructor(id, kind, priority, {transient = false, tab = null} = {}) {
        this.id = id;
        this.kind = kind;
        this.priority = priority;
        this.transient = transient;
        this.tab = tab;
        this.available = false;
        this.actor = null;
        this.manager = null;
    }

    ensureActor() {
        if (!this.actor)
            this.actor = this.build();
        return this.actor;
    }

    get height() { return null; }   // custom pill height while shown
    get width() { return null; }    // custom total width while shown
    scrollVolume() { return false; }
    build() { return new St.Widget(); }
    onShown() {}
    onHidden() {}
    onClick() { return false; }   // true = handled, no default action
    resized() { this.manager?.requestResize(this); }

    destroy() {
        this.onHidden();
        this.actor?.destroy();
        this.actor = null;
    }
}

function row() {
    return new St.BoxLayout({style_class: 'minie-act', y_align: CENTER, x_align: CENTER});
}

export class IdleActivity extends Activity {
    constructor() { super('idle', 'primary', -1); }
    build() {
        const b = row();
        b.add_child(new St.Widget({style_class: 'minie-idle', width: 36, height: 4, y_align: CENTER}));
        return b;
    }
}

export class ClockActivity extends Activity {
    constructor(settings) {
        super('clock', 'primary', 10, {tab: 'calendar'});
        this._settings = settings;
        this._src = 0;
    }

    build() {
        const b = row();
        this._label = new St.Label({style_class: 'minie-clock', y_align: CENTER});
        b.add_child(this._label);
        this._applyFont();
        this._tick();
        return b;
    }

    _format() {
        const secs = this._settings.get_boolean('clock-seconds');
        const h24 = this._settings.get_boolean('clock-24h');
        const fmt = h24 ? (secs ? '%H:%M:%S' : '%H:%M') : (secs ? '%-I:%M:%S %p' : '%-I:%M %p');
        return GLib.DateTime.new_now_local().format(fmt) ?? '';
    }

    _tick() {
        if (this._label)
            this._label.text = this._format();
    }

    _applyFont() {
        if (!this._label)
            return;
        const size = this._settings.get_int('clock-font-size');
        const desc = this._settings.get_string('clock-font');
        let css = size > 0 ? `font-size: ${size}px;` : '';
        if (desc) {
            const fd = Pango.FontDescription.from_string(desc);
            const fam = fd.get_family();
            if (fam)
                css += ` font-family: "${fam.split(',')[0].replace(/"/g, '')}";`;
            const w = fd.get_weight();
            if (w)
                css += ` font-weight: ${w};`;
            if (fd.get_style() === Pango.Style.ITALIC)
                css += ' font-style: italic;';
        }
        this._label.set_style(css);
    }

    refresh() {
        this._applyFont();
        this._tick();
        if (this._src)
            this._schedule();
        this.resized();
    }

    _schedule() {
        this._unschedule();
        this._tick();
        const period = this._settings.get_boolean('clock-seconds') ? 1000 : 60000;
        const now = GLib.get_real_time() / 1000;
        const delay = Math.ceil(period - (now % period)) + 15;
        this._src = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._src = 0;
            this._schedule();
            return GLib.SOURCE_REMOVE;
        });
    }

    _unschedule() {
        if (this._src) {
            GLib.Source.remove(this._src);
            this._src = 0;
        }
    }

    onShown() { this._schedule(); }
    onHidden() { this._unschedule(); }
}

export class MusicActivity extends Activity {
    constructor(ctx) {
        super('music', 'primary', 60, {tab: 'home'});
        this._ctx = ctx;           // {settings, art}
        this._player = null;
        this.lines = null;
        this._lastIdx = -2;
        this._shown = false;
        this._src = 0;
        this._artUrl = null;
        this._hi = false;
        this.visualizer = null;
    }

    build() {
        const b = row();
        this._art = new St.Bin({style_class: 'minie-art-sm', y_align: CENTER});
        this._art.set_size(22, 22);
        this._text = makeLabel('', 'minie-text');
        this._text.set_width(180);
        this.visualizer = new St.BoxLayout({style_class: 'minie-viz', y_align: CENTER, reactive: true});
        this._bars = [];
        const accent = this._ctx.settings.get_string('accent-color');
        for (let i = 0; i < 4; i++) {
            const bar = new St.Widget({y_align: CENTER, style: `background-color: ${accent}; border-radius: 2px;`});
            bar.set_size(3, 4);
            this._bars.push(bar);
            this.visualizer.add_child(bar);
        }
        b.add_child(this._art);
        b.add_child(this._text);
        b.add_child(this.visualizer);
        this._render();
        return b;
    }

    scrollVolume() { return this._player?.status === 'Playing'; }

    setPlayer(p) {
        const prevKey = this._key();
        this._player = p;
        if (this._key() !== prevKey)
            this._lastIdx = -2;
        this._render();
        this._syncTimer();
    }

    setLyrics(lines) {
        this.lines = lines;
        this._lastIdx = -2;
        this._render();
        this._syncTimer();
    }

    _key() {
        const m = this._player?.meta;
        return m ? `${m.title}|${m.artist}` : '';
    }

    _render() {
        if (!this.actor)
            return;
        const p = this._player;
        const m = p?.meta;
        let text = m ? (m.artist ? `${m.title} — ${m.artist}` : m.title) : '';
        if (this._lyricVisible()) {
            const idx = lineAt(this.lines, p.position() / 1000);
            this._lastIdx = idx;
            if (idx >= 0 && this.lines[idx].text)
                text = this.lines[idx].text;
        }
        if (this._text.text !== text)
            this._text.text = text;
        const url = m?.artUrl ?? '';
        if (url !== this._artUrl) {
            this._artUrl = url;
            this._art.set_style('background-color: rgba(255,255,255,0.12); border-radius: 6px;');
            this._ctx.art.resolve(url, path => {
                if (this.actor && path && url === this._artUrl)
                    this._art.set_style(`${pathToStyle(path, 22)} border-radius: 6px;`);
            });
        }
    }

    _lyricVisible() {
        return !!(this.lines && this._player?.status === 'Playing' && this._ctx.settings.get_boolean('lyrics-in-pill'));
    }

    _syncTimer() {
        const want = this._shown && this._player?.status === 'Playing';
        if (want && !this._src) {
            this._src = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                this._frame();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!want && this._src) {
            GLib.Source.remove(this._src);
            this._src = 0;
            this._settleBars();
        }
    }

    _frame() {
        if (!this.actor)
            return;
        this._hi = !this._hi;
        for (const bar of this._bars) {
            const h = 4 + Math.floor(Math.random() * 12);
            bar.ease({height: h, duration: 220, mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD});
        }
        if (this._lyricVisible()) {
            const idx = lineAt(this.lines, this._player.position() / 1000);
            if (idx !== this._lastIdx)
                this._render();
        }
    }

    _settleBars() {
        for (const bar of this._bars ?? [])
            bar.ease({height: 4, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    onShown() { this._shown = true; this._syncTimer(); }
    onHidden() { this._shown = false; this._syncTimer(); }
}

export class TimerActivity extends Activity {
    constructor(timer) {
        super('timer', 'primary', 50, {tab: 'timer'});
        this._timer = timer;
        this._unsub = null;
    }

    build() {
        const b = row();
        this._icon = makeIcon('alarm-symbolic', 16);
        this._label = new St.Label({style_class: 'minie-clock', y_align: CENTER});
        b.add_child(this._icon);
        b.add_child(this._label);
        this.update();
        return b;
    }

    update() {
        if (!this._label)
            return;
        const t = this._timer;
        this._label.text = t.state === 'finished' ? "Time's up" : formatDuration(t.remaining);
        this._icon.icon_name = t.state === 'paused' ? 'media-playback-pause-symbolic' : 'alarm-symbolic';
    }

    onShown() { this._unsub = this._timer.onChanged(() => this.update()); }
    onHidden() { this._unsub?.(); this._unsub = null; }
}

export class BluetoothActivity extends Activity {
    constructor(ctx) {
        super('bluetooth', 'status', 30, {tab: 'controls'});
        this._ctx = ctx;       // {onPicker(): bool, deviceIcon(dev): string|Gio.Icon}
        this._dev = null;
        this._connected = false;
    }

    build() {
        const b = row();
        b.set_style('spacing: 10px;');
        const chip = new St.Bin({style_class: 'minie-bt-chip', y_align: CENTER});
        this._icon = new St.Icon({icon_size: 18, style_class: 'minie-icon'});
        chip.set_child(this._icon);
        const col = new St.BoxLayout({vertical: true, y_align: CENTER});
        this._name = new St.Label({style_class: 'minie-title'});
        this._name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._name.set_style('max-width: 190px;');
        this._state = new St.Label({style_class: 'minie-sub'});
        this._state.set_style('font-size: 0.8em;');
        col.add_child(this._name);
        col.add_child(this._state);
        this._batt = row();
        this._batt.set_style('spacing: 6px;');
        this._glyph = new BatteryGlyph(24, 12);
        this._battText = new St.Label({style_class: 'minie-title', y_align: CENTER});
        this._batt.add_child(this._glyph.actor);
        this._batt.add_child(this._battText);
        b.add_child(chip);
        b.add_child(col);
        b.add_child(this._batt);
        this._render();
        return b;
    }

    // dev = null -> "No device connected"
    showDevice(dev, connected = true) {
        this._dev = dev;
        this._connected = connected && !!dev;
        this._render();
        this.resized();
    }

    _render() {
        if (!this.actor)
            return;
        const d = this._dev;
        const ic = d ? this._ctx.deviceIcon(d) : this._ctx.deviceIcon(null);
        if (typeof ic === 'string')
            this._icon.icon_name = ic;
        else
            this._icon.gicon = ic;
        if (!d) {
            this._name.text = 'Bluetooth';
            this._state.text = 'No device connected';
            this._batt.visible = false;
            return;
        }
        this._name.text = BluetoothService.nameOf(d);
        this._state.text = this._connected ? 'Connected' : 'Disconnected';
        const hasBatt = this._connected && d.battery !== null && d.battery !== undefined;
        this._batt.visible = hasBatt;
        if (hasBatt) {
            this._battText.text = `${d.battery}%`;
            this._glyph.set(d.battery);
        }
    }

    onClick() { return this._ctx.onPicker(); }
}

export class WifiActivity extends Activity {
    constructor() { super('wifi', 'status', 20); }

    build() {
        const b = row();
        this._icon = makeIcon('network-wireless-signal-good-symbolic', 16);
        this._name = makeLabel('', 'minie-text');
        this._name.set_style('max-width: 170px;');
        b.add_child(this._icon);
        b.add_child(this._name);
        return b;
    }

    update(ssid, strength) {
        if (!this.actor)
            return;
        this._icon.icon_name = signalIcon(strength);
        this._name.text = ssid ?? '';
        this.resized();
    }

    onClick() { return true; }   // display only
}

export class DndActivity extends Activity {
    constructor() {
        super('dnd', 'status', 25, {tab: 'controls'});
        this._on = true;
    }

    build() {
        const b = row();
        this._icon = makeIcon('notifications-disabled-symbolic', 16);
        this._label = new St.Label({text: 'Do Not Disturb', style_class: 'minie-text', y_align: CENTER});
        b.add_child(this._icon);
        b.add_child(this._label);
        return b;
    }

    setCustom(icon, text) {
        this.ensureActor();
        if (typeof icon === 'string')
            this._icon.icon_name = icon;
        else
            this._icon.gicon = icon;
        this._label.text = text;
        this.resized();
    }

    setOn(on) {
        this._on = on;
        if (!this.actor)
            return;
        this._icon.icon_name = on ? 'notifications-disabled-symbolic' : 'preferences-system-notifications-symbolic';
        this._label.text = on ? 'Do Not Disturb' : 'Notifications on';
        this.resized();
    }
}

export class NotificationActivity extends Activity {
    constructor(settings, onActivate) {
        super('notification', 'status', 0, {transient: true});
        this._s = settings;
        this._onActivate = onActivate;
        this._notif = null;
    }

    get height() { return this._s.get_int('notification-height'); }
    get width() { return this._s.get_int('notification-width'); }

    build() {
        const b = row();
        b.set_style('spacing: 12px;');
        this._icon = new St.Icon({icon_size: 36, y_align: CENTER, style_class: 'minie-icon'});
        this._col = new St.BoxLayout({vertical: true, y_align: CENTER, x_expand: true});
        this._title = makeLabel('', 'minie-title');
        this._body = new St.Label({style_class: 'minie-sub', x_align: Clutter.ActorAlign.START});
        this._body.clutter_text.line_wrap = true;
        this._body.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._col.add_child(this._title);
        this._col.add_child(this._body);
        b.add_child(this._icon);
        b.add_child(this._col);
        return b;
    }

    show(n) {
        this.ensureActor();
        this._notif = n;
        const w = this.width, h = this.height;
        const font = this._s.get_int('notification-font-size');
        const iconSize = Math.max(20, Math.min(56, h - 28));
        const contentW = w - 2 * padXFor(h);
        this.actor.set_width(contentW);
        this._icon.icon_size = iconSize;
        let gicon = null;
        try { gicon = n.gicon ?? n.source?.icon ?? null; } catch (_e) { gicon = null; }
        if (gicon)
            this._icon.gicon = gicon;
        else
            this._icon.icon_name = 'dialog-information-symbolic';

        const app = n.source?.title ?? '';
        const body = (n.body ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        this._title.text = n.title || app;
        this._title.set_style(`font-size: ${font}px; font-weight: 800;`);
        const textW = contentW - iconSize - 12;
        this._col.set_width(textW);
        this._title.set_width(textW);
        const lineH = Math.round((font - 1) * 1.35);
        const titleH = Math.round(font * 1.4);
        const lines = Math.max(1, Math.min(5, Math.floor((h - titleH - 16) / lineH)));
        this._body.text = body || (n.title ? app : '');
        this._body.visible = !!this._body.text;
        this._body.set_style(`font-size: ${font - 1}px;`);
        this._body.set_width(textW);
        this._body.set_height(lines * lineH);
    }

    onClick() {
        this._onActivate(this._notif);
        return true;
    }
}

export class OsdActivity extends Activity {
    constructor() { super('osd', 'status', 0, {transient: true}); }

    build() {
        const b = row();
        this._icon = new St.Icon({icon_size: 16, y_align: CENTER, style_class: 'minie-icon'});
        this._track = new St.Widget({style_class: 'minie-osd-track', y_align: CENTER});
        this._track.set_size(120, 5);
        this._fill = new St.Widget({style_class: 'minie-osd-fill'});
        this._fill.set_height(5);
        this._track.add_child(this._fill);
        this._pct = new St.Label({style_class: 'minie-sub', y_align: CENTER, text: '0%'});
        this._pct.set_width(40);
        this._pct.set_style('text-align: right;');
        this._pct.clutter_text.line_alignment = Pango.Alignment.RIGHT;
        b.set_style('spacing: 10px;');
        b.add_child(this._icon);
        b.add_child(this._track);
        b.add_child(this._pct);
        return b;
    }

    show({icon, value}) {
        this.ensureActor();
        if (icon)
            this._icon.gicon = icon;
        const frac = Math.max(0, Math.min(1, value));
        this._fill.set_width(Math.round(120 * frac));
        this._pct.text = `${Math.round(value * 100)}%`;
    }
}

export class WorkspaceActivity extends Activity {
    constructor() { super('workspace', 'status', 0, {transient: true}); }

    build() {
        this._box = row();
        return this._box;
    }

    show(count, active) {
        this.ensureActor();
        this._box.destroy_all_children();
        for (let i = 0; i < count; i++) {
            const dot = new St.Widget({
                style_class: i === active ? 'minie-ws-dot active' : 'minie-ws-dot',
                y_align: CENTER,
            });
            dot.set_size(i === active ? 18 : 6, 6);
            this._box.add_child(dot);
        }
        this._box.add_child(new St.Label({text: `${active + 1}`, style_class: 'minie-sub', y_align: CENTER}));
    }
}

export class WeatherActivity extends Activity {
    constructor() {
        super('weather', 'status', 15, {tab: 'weather'});
        this._data = null;
    }

    build() {
        const b = row();
        this._icon = makeIcon('weather-clear-symbolic', 18);
        this._temp = new St.Label({style_class: 'minie-title', y_align: CENTER});
        this._text = makeLabel('', 'minie-sub');
        this._text.set_style('max-width: 150px;');
        b.add_child(this._icon);
        b.add_child(this._temp);
        b.add_child(this._text);
        this._render();
        return b;
    }

    update(data, units, place) {
        this._data = {data, units, place};
        this._render();
        this.resized();
    }

    _render() {
        if (!this.actor || !this._data)
            return;
        const {data, units, place} = this._data;
        const cur = data.current;
        const w = describeWeather(cur.weather_code, cur.is_day === 1);
        this._icon.icon_name = w.icon;
        this._temp.text = `${Math.round(cur.temperature_2m)}${units === 'imperial' ? '°F' : '°C'}`;
        this._text.text = `${w.text}${place ? ` · ${place.split(',')[0]}` : ''}`;
    }
}

// ---------------------------------------------------------------- cat
export class CatActivity extends Activity {
    constructor(settings) {
        super('cat', 'status', 0, {transient: true});
        this._s = settings;
        this._alt = false;
        this._ltr = true;
        this._speed = 150;
        this._src = 0;
        this._t0 = 0;
        this._style = 'walker';
        this._effect = 'none';
    }

    get width() { return this._s.get_int('cat-width'); }

    build() {
        const b = row();
        this._area = new St.DrawingArea();
        this._area.connect('repaint', () => this._paint());
        b.add_child(this._area);
        this._layout();
        return b;
    }

    _layout() {
        if (!this._area)
            return;
        const h = this._s.get_int('pill-height');
        this._w = Math.max(80, this.width - 2 * padXFor(h));
        this._h = Math.max(16, h - 6);
        this._area.set_size(this._w, this._h);
        const def = this._def();
        this._rows = Math.max(12, Math.min(30, Math.round((this._h - 4) / 1.2 * (def.shrink ?? 1))));
        this._cell = (this._h - 4) / Math.round(this._rows / (def.shrink ?? 1));
    }

    _def() {
        return CAT_STYLES[this._style] ?? CAT_STYLES.walker;
    }

    _spriteWidthPx() {
        return Math.round(this._def().width * this._rows / 16) * this._cell;
    }

    // pick direction + speed; returns how long (ms) the run lasts
    begin() {
        const s = this._s;
        const dir = s.get_string('cat-direction');
        if (dir === 'ltr')
            this._ltr = true;
        else if (dir === 'rtl')
            this._ltr = false;
        else if (dir === 'random')
            this._ltr = Math.random() < 0.5;
        else {
            this._alt = !this._alt;
            this._ltr = this._alt;
        }
        // "random" picks a different cat / effect for every appearance
        const styles = Object.keys(CAT_STYLES);
        const chosen = s.get_string('cat-style');
        this._style = chosen === 'random' ? styles[Math.floor(Math.random() * styles.length)] : chosen;
        const fx = s.get_string('cat-effect');
        this._effect = fx === 'random' ? CAT_EFFECTS[Math.floor(Math.random() * CAT_EFFECTS.length)] : fx;
        const a = s.get_int('cat-speed-min'), b = s.get_int('cat-speed-max');
        this._speed = Math.min(a, b) + Math.random() * Math.abs(b - a);
        this.ensureActor();
        this._layout();
        const total = this._w + this._spriteWidthPx();
        return Math.round(total / this._speed * 1000);
    }

    _paint() {
        const cr = this._area.get_context();
        const [w, h] = this._area.get_surface_size();
        const def = this._def();
        const dist = (monotonicSeconds() - this._t0) * this._speed;
        const phase = dist / (def.stride * this._cell) * Math.PI;
        const sprite = catSprite(this._style, this._rows, phase);
        const sw = sprite.w * this._cell;
        const x = this._ltr ? -sw + dist : w - dist;
        let y = (h - sprite.h * this._cell) / 2;
        if (def.hop)
            y = h - sprite.h * this._cell - 1 - Math.abs(Math.sin(phase)) * this._cell * def.hop;
        const t = monotonicSeconds() - this._t0;
        drawEffect(cr, this._effect, {
            t, dist, speed: this._speed, ltr: this._ltr, w, h, x, sw, cell: this._cell,
            sh: sprite.h * this._cell, ground: y + sprite.h * this._cell,
        });
        // sprites face right; mirror them when running right-to-left
        drawDots(cr, sprite, x, y, this._cell, !this._ltr, [1, 1, 1, 0.95]);
        cr.$dispose();
    }

    onShown() {
        this._t0 = monotonicSeconds();
        if (!this._src) {
            this._src = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
                this._area?.queue_repaint();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    onHidden() {
        if (this._src) {
            GLib.Source.remove(this._src);
            this._src = 0;
        }
    }
}

// ---------------------------------------------------------------- downloads
export class DownloadActivity extends Activity {
    constructor(icon, onOpen) {
        super('download', 'primary', 55);
        this._icon = icon;
        this._onOpen = onOpen;
        this._doneUntil = 0;
        this._donePath = null;
        this._src = 0;
        this._up = false;
        this._shown = false;
    }

    build() {
        const b = row();
        b.set_style('spacing: 10px;');
        this._ic = makeIcon(this._icon, 20);
        const col = new St.BoxLayout({vertical: true, y_align: CENTER});
        this._title = makeLabel('Downloading…', 'minie-title');
        this._title.set_style('max-width: 200px;');
        this._sub = new St.Label({style_class: 'minie-sub'});
        this._sub.set_style('font-size: 0.8em;');
        col.add_child(this._title);
        col.add_child(this._sub);
        b.add_child(this._ic);
        b.add_child(col);
        return b;
    }

    setProgress(sum) {
        if (GLib.get_monotonic_time() < this._doneUntil)
            return;
        this._donePath = null;
        this._pending = sum;
        if (!this.actor)
            return;
        this._title.text = sum.name;
        this._sub.text = sum.size === null
            ? `${formatBytes(sum.speed)}/s`
            : `${formatBytes(sum.size)} · ${formatBytes(sum.speed)}/s${sum.count > 1 ? ` · ${sum.count} files` : ''}`;
        this.resized();
    }

    setDone(name, path) {
        this._doneUntil = GLib.get_monotonic_time() + 5e6;
        this._donePath = path;
        this.ensureActor();
        this._title.text = name;
        this._sub.text = 'Download complete ✓';
        this._ic.translation_y = 0;
        this.resized();
    }

    onClick() {
        this._onOpen(this._donePath);
        return true;
    }

    _bounce() {
        if (!this._ic || GLib.get_monotonic_time() < this._doneUntil)
            return;
        this._up = !this._up;
        this._ic.ease({translation_y: this._up ? 3 : 0, duration: 380, mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD});
    }

    onShown() {
        this._shown = true;
        if (!this._src) {
            this._src = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 420, () => {
                this._bounce();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    onHidden() {
        this._shown = false;
        if (this._src) {
            GLib.Source.remove(this._src);
            this._src = 0;
        }
    }
}

// ---------------------------------------------------------------- screen recording
export class RecordActivity extends Activity {
    constructor(onStop) {
        super('record', 'primary', 70);
        this._onStop = onStop;
        this._t0 = 0;
        this._saved = false;
        this._src = 0;
        this._pulse = 0;
        this._hi = true;
    }

    build() {
        const b = row();
        b.set_style('spacing: 8px;');
        this._dot = new St.Widget({style_class: 'minie-rec-dot', y_align: CENTER});
        this._dot.set_size(10, 10);
        this._label = new St.Label({style_class: 'minie-title', y_align: CENTER});
        this._time = new St.Label({style_class: 'minie-clock', y_align: CENTER});
        b.add_child(this._dot);
        b.add_child(this._label);
        b.add_child(this._time);
        this._render();
        return b;
    }

    begin() {
        this._t0 = GLib.get_monotonic_time();
        this._saved = false;
        this._render();
    }

    setSaved() {
        this._saved = true;
        this.ensureActor();
        this._render();
        this.resized();
    }

    _render() {
        if (!this.actor)
            return;
        this._dot.set_style(this._saved ? 'background-color: #34c759;' : 'background-color: #ff3b30; box-shadow: 0 0 8px #ff3b30;');
        this._dot.opacity = 255;
        this._label.text = this._saved ? 'Recording saved' : 'REC';
        this._time.visible = !this._saved;
        this._time.text = formatDuration((GLib.get_monotonic_time() - this._t0) / 1e6);
    }

    onClick() {
        if (!this._saved)
            this._onStop();
        return true;
    }

    onShown() {
        if (this._saved || this._src)
            return;
        this._src = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            if (this.actor && !this._saved)
                this._time.text = formatDuration((GLib.get_monotonic_time() - this._t0) / 1e6);
            return GLib.SOURCE_CONTINUE;
        });
        this._pulse = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
            if (this.actor && !this._saved) {
                this._hi = !this._hi;
                this._dot.ease({opacity: this._hi ? 255 : 90, duration: 700, mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD});
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    onHidden() {
        for (const k of ['_src', '_pulse']) {
            if (this[k]) {
                GLib.Source.remove(this[k]);
                this[k] = 0;
            }
        }
    }
}

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';
import {Bag, makeLabel, makeButton, formatDuration} from '../util.js';
import {lineAt} from '../lrc.js';
import {pathToStyle} from '../services/art.js';

export class HomeTab {
    constructor(ctx) {
        this._ctx = ctx;
        this._bag = new Bag();
        this._dragging = false;
        this._ignore = false;
        this._artUrl = null;
        this.actor = new St.BoxLayout({vertical: true, style_class: 'minie-tab', x_expand: true, y_expand: true});
        this._mpris = ctx.mpris();
        this._unsub = this._mpris?.onChanged(() => this._render());
        this._render();
    }

    _player() {
        return this._ctx.settings.get_boolean('music-enabled') ? this._mpris?.active ?? null : null;
    }

    _render() {
        this._bag.clear();
        this.actor.destroy_all_children();
        this._slider = null;
        const p = this._player();
        if (!p)
            this._renderIdle();
        else
            this._renderPlayer(p);
    }

    _renderIdle() {
        const box = new St.BoxLayout({vertical: true, x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.CENTER});
        const time = new St.Label({style_class: 'minie-big', x_align: Clutter.ActorAlign.CENTER});
        const date = new St.Label({style_class: 'minie-sub', x_align: Clutter.ActorAlign.CENTER});
        const upd = () => {
            const now = GLib.DateTime.new_now_local();
            time.text = now.format(this._ctx.settings.get_boolean('clock-24h') ? '%H:%M' : '%-I:%M %p') ?? '';
            date.text = now.format('%A, %-d %B %Y') ?? '';
            return true;
        };
        upd();
        this._bag.timeout(1000, upd);
        const hint = new St.Label({text: 'Nothing playing', style_class: 'minie-sub', x_align: Clutter.ActorAlign.CENTER});
        hint.set_style('margin-top: 14px;');
        box.add_child(time);
        box.add_child(date);
        box.add_child(hint);
        this.actor.add_child(box);
    }

    _renderPlayer(p) {
        const top = new St.BoxLayout({style_class: 'minie-row', x_expand: true});
        this._art = new St.Bin({style_class: 'minie-art-lg', y_align: Clutter.ActorAlign.START});
        this._art.set_size(96, 96);
        this._applyArt(p.meta.artUrl);
        const col = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const title = makeLabel(p.meta.title, 'minie-big-title');
        const artist = makeLabel(p.meta.artist, 'minie-sub');
        const album = makeLabel(p.meta.album, 'minie-sub');
        col.add_child(title);
        col.add_child(artist);
        if (p.meta.album)
            col.add_child(album);
        top.add_child(this._art);
        top.add_child(col);
        this.actor.add_child(top);

        // lyrics block
        const lyr = new St.BoxLayout({vertical: true, style_class: 'minie-lyrics', x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._lPrev = makeLabel('', 'minie-lyric-dim');
        this._lCur = makeLabel('', 'minie-lyric-cur');
        this._lNext = makeLabel('', 'minie-lyric-dim');
        for (const l of [this._lPrev, this._lCur, this._lNext]) {
            l.x_align = Clutter.ActorAlign.CENTER;
            lyr.add_child(l);
        }
        this.actor.add_child(lyr);

        // progress
        const prog = new St.BoxLayout({style_class: 'minie-row', x_expand: true});
        this._tPos = new St.Label({text: '0:00', style_class: 'minie-sub', y_align: Clutter.ActorAlign.CENTER});
        this._tLen = new St.Label({text: '0:00', style_class: 'minie-sub', y_align: Clutter.ActorAlign.CENTER});
        this._slider = new Slider(0);
        this._slider.x_expand = true;
        this._slider.y_align = Clutter.ActorAlign.CENTER;
        this._bag.connect(this._slider, 'drag-begin', () => { this._dragging = true; });
        this._bag.connect(this._slider, 'drag-end', () => {
            this._dragging = false;
            const len = p.meta.length;
            if (len > 0)
                p.setPosition(this._slider.value * len);
        });
        prog.add_child(this._tPos);
        prog.add_child(this._slider);
        prog.add_child(this._tLen);
        this.actor.add_child(prog);

        // controls
        const ctl = new St.BoxLayout({style_class: 'minie-controls', x_align: Clutter.ActorAlign.CENTER});
        ctl.add_child(makeButton('media-skip-backward-symbolic', () => p.previous(), 20, 'minie-btn minie-btn-lg'));
        this._pp = makeButton(p.status === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
            () => p.playPause(), 24, 'minie-btn minie-btn-lg minie-btn-main');
        ctl.add_child(this._pp);
        ctl.add_child(makeButton('media-skip-forward-symbolic', () => p.next(), 20, 'minie-btn minie-btn-lg'));
        this.actor.add_child(ctl);

        this._tickPlayer(p);
        this._bag.timeout(400, () => {
            this._tickPlayer(p);
            return true;
        });
    }

    _applyArt(url) {
        this._artUrl = url;
        this._art.set_style('background-color: rgba(255,255,255,0.1); border-radius: 14px;');
        this._ctx.art.resolve(url, path => {
            if (this._art && path && url === this._artUrl)
                this._art.set_style(`${pathToStyle(path, 96)} border-radius: 14px;`);
        });
    }

    _tickPlayer(p) {
        const len = p.meta.length, pos = p.position();
        if (this._slider && !this._dragging) {
            this._ignore = true;
            this._slider.value = len > 0 ? Math.min(1, pos / len) : 0;
            this._ignore = false;
        }
        this._tPos.text = formatDuration(pos / 1e6);
        this._tLen.text = len > 0 ? formatDuration(len / 1e6) : '--:--';
        const icon = p.status === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        if (this._pp.child.icon_name !== icon)
            this._pp.child.icon_name = icon;

        const lines = this._ctx.music.lines;
        if (!lines) {
            this._lPrev.text = '';
            this._lCur.text = this._ctx.settings.get_boolean('lyrics-enabled') ? 'No synced lyrics' : '';
            this._lNext.text = '';
            return;
        }
        const i = lineAt(lines, pos / 1000);
        this._lPrev.text = i > 0 ? lines[i - 1].text : '';
        this._lCur.text = i >= 0 ? lines[i].text || '♪' : '';
        this._lNext.text = i + 1 < lines.length ? lines[i + 1].text : '';
    }

    destroy() {
        this._unsub?.();
        this._bag.clear();
        this.actor.destroy();
    }
}

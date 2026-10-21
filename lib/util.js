import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Soup from 'gi://Soup?version=3.0';

// Tracks signal connections and GLib sources so everything can be released at once.
export class Bag {
    constructor() {
        this._conns = [];
        this._srcs = new Set();
    }

    connect(obj, signal, cb) {
        const id = obj.connect(signal, cb);
        this._conns.push([obj, id]);
        return id;
    }

    timeout(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            const keep = fn();
            if (!keep)
                this._srcs.delete(id);
            return keep ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        });
        this._srcs.add(id);
        return id;
    }

    cancel(id) {
        if (id && this._srcs.delete(id))
            GLib.Source.remove(id);
    }

    clear() {
        for (const [obj, id] of this._conns) {
            try { obj.disconnect(id); } catch (_e) { /* object already gone */ }
        }
        this._conns = [];
        for (const id of this._srcs)
            GLib.Source.remove(id);
        this._srcs.clear();
    }
}

export function makeLabel(text = '', styleClass = '') {
    const l = new St.Label({text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});
    l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return l;
}

export function makeIcon(name, size = 16, styleClass = '') {
    const props = {icon_size: size, style_class: `minie-icon ${styleClass}`, y_align: Clutter.ActorAlign.CENTER};
    if (typeof name === 'string')
        props.icon_name = name;
    else
        props.gicon = name;
    return new St.Icon(props);
}

// horizontal padding of the pill for a given height
export function padXFor(h) {
    return Math.max(10, Math.min(22, Math.round(h * 0.38)));
}

export function makeButton(iconName, cb, size = 16, styleClass = 'minie-btn') {
    const b = new St.Button({
        style_class: styleClass, can_focus: true, reactive: true, track_hover: true,
        child: makeIcon(iconName, size),
    });
    b.connect('clicked', cb);
    return b;
}

export function formatDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const p = n => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function hasSchema(id) {
    const src = Gio.SettingsSchemaSource.get_default();
    return !!(src && src.lookup(id, true));
}

export function newSession() {
    return new Soup.Session({timeout: 10, user_agent: 'minie-pill-gnome-shell/1.0'});
}

function httpGet(session, url, cancellable) {
    return new Promise((resolve, reject) => {
        const msg = Soup.Message.new('GET', url);
        if (!msg) {
            reject(new Error('bad url'));
            return;
        }
        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable, (s, res) => {
            try {
                const bytes = s.send_and_read_finish(res);
                if (msg.get_status() !== Soup.Status.OK) {
                    let body = '';
                    try { body = new TextDecoder().decode(bytes.toArray()).slice(0, 160); } catch (_e) { /* binary */ }
                    throw new Error(`HTTP ${msg.get_status()} ${body}`.trim());
                }
                resolve(bytes.toArray());
            } catch (e) {
                reject(e);
            }
        });
    });
}

export const httpGetBytes = (session, url, cancellable = null) => httpGet(session, url, cancellable);
export const httpGetText = async (session, url, cancellable = null) =>
    new TextDecoder().decode(await httpGet(session, url, cancellable));
export const httpGetJson = async (session, url, cancellable = null) =>
    JSON.parse(await httpGetText(session, url, cancellable));

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';

// File shelf: holds file URIs. Add by copying files in the file manager, then "Paste from clipboard".
// (Drag-and-drop from other apps into shell actors is not supported on Wayland.)
export class ShelfService {
    constructor(settings) {
        this._settings = settings;
        this._cbs = new Set();
    }

    get uris() {
        return this._settings.get_strv('shelf-uris');
    }

    _set(uris) {
        this._settings.set_strv('shelf-uris', uris);
        this._emit();
    }

    remove(uri) { this._set(this.uris.filter(u => u !== uri)); }
    clear() { this._set([]); }

    addFromClipboard(done) {
        const cb = St.Clipboard.get_default();
        const parse = bytes => {
            if (!bytes || !bytes.get_size())
                return [];
            const text = new TextDecoder().decode(bytes.toArray());
            return text.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('file://'));
        };
        const finish = found => {
            const cur = this.uris;
            const fresh = found.filter(u => !cur.includes(u));
            if (fresh.length)
                this._set([...cur, ...fresh].slice(-40));
            done?.(fresh.length);
        };
        cb.get_content(St.ClipboardType.CLIPBOARD, 'x-special/gnome-copied-files', (_c, bytes) => {
            const found = parse(bytes);
            if (found.length)
                finish(found);
            else
                cb.get_content(St.ClipboardType.CLIPBOARD, 'text/uri-list', (_c2, b2) => finish(parse(b2)));
        });
    }

    // put a file back on the clipboard so it can be pasted into the file manager
    copyToClipboard(uri) {
        const bytes = new GLib.Bytes(new TextEncoder().encode(`copy\n${uri}`));
        St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, 'x-special/gnome-copied-files', bytes);
    }

    open(uri) {
        try {
            Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
        } catch (e) {
            console.warn(`minie-pill: cannot open ${uri}: ${e.message}`);
        }
    }

    onChanged(cb) {
        this._cbs.add(cb);
        return () => this._cbs.delete(cb);
    }

    _emit() {
        for (const cb of [...this._cbs])
            cb();
    }

    destroy() {
        this._cbs.clear();
    }
}

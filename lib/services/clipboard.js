import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

// In-memory text clipboard history (never written to disk).
export class ClipboardService {
    constructor(settings) {
        this._settings = settings;
        this.items = [];
        this._cbs = new Set();
        this._id = 0;
        this._debounce = 0;
        this._sel = null;
        this._poll = 0;
        this._lastText = null;
    }

    start() {
        // low-frequency poll as a safety net: owner-changed is not delivered for every client on Wayland
        this._poll = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this._read();
            return GLib.SOURCE_CONTINUE;
        });
        this._read();
        this._sel = global.display.get_selection();
        this._id = this._sel.connect('owner-changed', (_s, type) => {
            if (type !== Meta.SelectionType.SELECTION_CLIPBOARD)
                return;
            if (this._debounce)
                GLib.Source.remove(this._debounce);
            this._debounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                this._debounce = 0;
                this._read();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _read() {
        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_c, text) => {
            if (!text || !text.trim() || text.length > 20000 || text === this._lastText)
                return;
            this._lastText = text;
            this._add(text);
        });
    }

    _add(text) {
        const idx = this.items.findIndex(i => i.text === text);
        let item;
        if (idx >= 0)
            [item] = this.items.splice(idx, 1);
        else
            item = {text, pinned: false};
        this.items.unshift(item);
        const max = this._settings.get_int('clipboard-max');
        while (this.items.length > max) {
            let i = -1;
            for (let j = this.items.length - 1; j >= 0; j--) {
                if (!this.items[j].pinned) { i = j; break; }
            }
            if (i < 0)
                break;
            this.items.splice(i, 1);
        }
        this._emit();
    }

    copy(text) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
    }

    togglePin(item) { item.pinned = !item.pinned; this._emit(); }
    remove(item) { this.items = this.items.filter(i => i !== item); this._emit(); }
    clear() { this.items = this.items.filter(i => i.pinned); this._emit(); }

    sorted() {
        return [...this.items.filter(i => i.pinned), ...this.items.filter(i => !i.pinned)];
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
        if (this._poll)
            GLib.Source.remove(this._poll);
        this._poll = 0;
        if (this._id)
            this._sel.disconnect(this._id);
        if (this._debounce)
            GLib.Source.remove(this._debounce);
        this._id = 0;
        this._debounce = 0;
        this.items = [];
        this._cbs.clear();
    }
}

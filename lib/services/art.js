import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {httpGetBytes} from '../util.js';

// Resolves album-art URLs (file:// or http(s)://) to a local file path, with a small disk cache.
export class ArtCache {
    constructor(session) {
        this._session = session;
        this._dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'minie-pill']);
        this._dead = false;
    }

    prune() {
        try {
            GLib.mkdir_with_parents(this._dir, 0o755);
            const en = Gio.File.new_for_path(this._dir).enumerate_children('standard::name,time::modified', 0, null);
            const cutoff = GLib.get_real_time() / 1e6 - 3 * 86400;
            let info;
            while ((info = en.next_file(null))) {
                if (info.get_modification_date_time().to_unix() < cutoff)
                    Gio.File.new_for_path(GLib.build_filenamev([this._dir, info.get_name()])).delete(null);
            }
        } catch (_e) { /* cache pruning is best effort */ }
    }

    resolve(url, cb) {
        if (!url)
            return cb(null);
        if (url.startsWith('file://'))
            return cb(Gio.File.new_for_uri(url).get_path());
        if (!/^https?:\/\//.test(url))
            return cb(null);
        const path = GLib.build_filenamev([this._dir, GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, url, -1)]);
        if (GLib.file_test(path, GLib.FileTest.EXISTS))
            return cb(path);
        httpGetBytes(this._session, url).then(bytes => {
            if (this._dead)
                return;
            GLib.mkdir_with_parents(this._dir, 0o755);
            GLib.file_set_contents(path, bytes);
            cb(path);
        }).catch(() => {
            if (!this._dead)
                cb(null);
        });
        return null;
    }

    destroy() {
        this._dead = true;
    }
}

export function pathToStyle(path, size) {
    const uri = Gio.File.new_for_path(path).get_uri();
    return `background-image: url("${uri}"); background-size: ${size}px ${size}px;`;
}

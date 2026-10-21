import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// Two detectors:
//  1. browser temp files (.crdownload / .part / ...) growing in watched folders -> name, size, speed
//  2. total network receive rate above a threshold (any app, any folder, e.g. Brave, wget, apt) -> speed only
const TEMP = /\.(crdownload|part|download|opdownload|partial|aria2)$/i;
const IGNORE_IFACE = /^(lo|docker|br-|veth|virbr|tun|tap|vmnet)/;

export function formatBytes(n) {
    if (n < 1024)
        return `${Math.round(n)} B`;
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do {
        n /= 1024;
        i++;
    } while (n >= 1024 && i < u.length - 1);
    return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

export class DownloadService {
    constructor(settings) {
        this._s = settings;
        this.active = new Map();     // path -> {name, size, speed, at}
        this.dirs = [];
        this._monitors = [];
        this._poll = 0;
        this._netPoll = 0;
        this._net = {last: null, at: 0, speed: 0, hot: 0, cold: 0, active: false};
        this._cbs = new Set();
    }

    get dir() { return this.dirs[0] ?? GLib.get_home_dir(); }

    start() {
        const seen = new Set();
        const add = d => {
            if (d && !seen.has(d)) {
                seen.add(d);
                this.dirs.push(d);
            }
        };
        add(GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD));
        add(GLib.build_filenamev([GLib.get_home_dir(), 'Downloads']));
        const extra = this._s.get_string('download-dir').trim();
        if (extra)
            add(extra.replace(/^~/, GLib.get_home_dir()));
        for (const d of this.dirs)
            this._watch(d);
        if (this._s.get_boolean('download-net-enabled'))
            this._startNet();
    }

    _watch(path) {
        try {
            const dir = Gio.File.new_for_path(path);
            if (!dir.query_exists(null))
                return;
            const mon = dir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
            mon.connect('changed', (_m, file, other, type) => this._onEvent(file, other, type));
            this._monitors.push(mon);
            console.log(`minie-pill: watching downloads in ${path}`);
            const en = dir.enumerate_children('standard::name', 0, null);
            let info;
            while ((info = en.next_file(null))) {
                if (TEMP.test(info.get_name()))
                    this._track(GLib.build_filenamev([path, info.get_name()]), false);
            }
            if (this.active.size)
                this._startPoll();
        } catch (e) {
            console.warn(`minie-pill: cannot watch ${path}: ${e.message}`);
        }
    }

    _onEvent(file, other, type) {
        const E = Gio.FileMonitorEvent;
        const name = file.get_basename() ?? '';
        switch (type) {
        case E.CREATED:
        case E.CHANGED:
        case E.MOVED_IN:
        case E.CHANGES_DONE_HINT:
            if (TEMP.test(name))
                this._track(file.get_path(), true);
            break;
        case E.RENAMED: {
            const newName = other?.get_basename() ?? '';
            if (TEMP.test(name) && !TEMP.test(newName))
                this._finish(file.get_path(), other.get_path());
            else if (!TEMP.test(name) && TEMP.test(newName))
                this._track(other.get_path(), true);
            else if (TEMP.test(name) && TEMP.test(newName)) {
                this.active.delete(file.get_path());
                this._track(other.get_path(), true);
            }
            break;
        }
        case E.DELETED:
        case E.MOVED_OUT:
            if (this.active.delete(file.get_path()))
                this._emit({type: 'cancel'});
            break;
        default:
            break;
        }
    }

    _track(path, emit) {
        if (this.active.has(path))
            return;
        const name = GLib.path_get_basename(path).replace(TEMP, '');
        console.log(`minie-pill: download started: ${name || path}`);
        this.active.set(path, {name, size: this._size(path), speed: 0, at: GLib.get_monotonic_time()});
        this._startPoll();
        if (emit)
            this._emit({type: 'start'});
    }

    _finish(oldPath, newPath) {
        if (!this.active.delete(oldPath))
            return;
        console.log(`minie-pill: download finished: ${newPath}`);
        this._emit({type: 'done', name: GLib.path_get_basename(newPath), path: newPath});
    }

    _size(path) {
        try {
            return Gio.File.new_for_path(path).query_info('standard::size', 0, null).get_size();
        } catch (_e) {
            return 0;
        }
    }

    _startPoll() {
        if (this._poll)
            return;
        this._poll = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            const now = GLib.get_monotonic_time();
            for (const [path, d] of [...this.active]) {
                if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
                    this.active.delete(path);
                    continue;
                }
                const size = this._size(path);
                const dt = (now - d.at) / 1e6 || 1;
                const inst = Math.max(0, (size - d.size) / dt);
                d.speed = d.speed ? d.speed * 0.6 + inst * 0.4 : inst;
                d.size = size;
                d.at = now;
            }
            this._emit({type: 'progress'});
            if (!this.active.size) {
                this._poll = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    // ---- network-speed detector
    _rxBytes() {
        try {
            const [ok, bytes] = GLib.file_get_contents('/proc/net/dev');
            if (!ok)
                return null;
            let total = 0;
            for (const line of new TextDecoder().decode(bytes).split('\n').slice(2)) {
                const m = /^\s*([^:\s]+):\s*(\d+)/.exec(line);
                if (m && !IGNORE_IFACE.test(m[1]))
                    total += Number(m[2]);
            }
            return total;
        } catch (_e) {
            return null;
        }
    }

    _startNet() {
        if (this._netPoll)
            return;
        this._net.last = this._rxBytes();
        this._net.at = GLib.get_monotonic_time();
        this._netPoll = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            const rx = this._rxBytes();
            const now = GLib.get_monotonic_time();
            const n = this._net;
            if (rx !== null && n.last !== null) {
                const speed = Math.max(0, (rx - n.last) / ((now - n.at) / 1e6));
                n.speed = n.speed ? n.speed * 0.5 + speed * 0.5 : speed;
                const limit = this._s.get_int('download-net-threshold') * 1024;
                if (n.speed >= limit) {
                    n.hot++;
                    n.cold = 0;
                } else {
                    n.cold++;
                    n.hot = 0;
                }
                const was = n.active;
                if (!was && n.hot >= 2)
                    n.active = true;
                else if (was && n.cold >= 2)
                    n.active = false;
                if (n.active || was)
                    this._emit({type: 'net'});
            }
            n.last = rx;
            n.at = now;
            return GLib.SOURCE_CONTINUE;
        });
    }

    // aggregate for the pill (null = nothing downloading)
    summary() {
        const items = [...this.active.values()];
        if (items.length) {
            const latest = items[items.length - 1];
            return {
                name: latest.name || 'Downloading…',
                size: items.reduce((a, d) => a + d.size, 0),
                speed: items.reduce((a, d) => a + d.speed, 0),
                count: items.length,
            };
        }
        if (this._net.active)
            return {name: 'Downloading…', size: null, speed: this._net.speed, count: 1};
        return null;
    }

    onChanged(cb) {
        this._cbs.add(cb);
        return () => this._cbs.delete(cb);
    }

    _emit(ev) {
        for (const cb of [...this._cbs])
            cb(ev);
    }

    destroy() {
        for (const id of [this._poll, this._netPoll]) {
            if (id)
                GLib.Source.remove(id);
        }
        this._poll = this._netPoll = 0;
        for (const m of this._monitors)
            m.cancel();
        this._monitors = [];
        this._cbs.clear();
        this.active.clear();
    }
}

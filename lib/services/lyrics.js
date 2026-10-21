import Gio from 'gi://Gio';
import {httpGetJson} from '../util.js';
import {parseLrc} from '../lrc.js';

function enc(obj) {
    return Object.entries(obj)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
}

// browsers/YouTube often give "Artist - Song" as the title and no artist
export function cleanMeta(meta) {
    let title = meta.title ?? '';
    let artist = (meta.artist ?? '').split(',')[0].trim();
    if (!artist && title.includes(' - ')) {
        const [a, ...rest] = title.split(' - ');
        artist = a.trim();
        title = rest.join(' - ').trim();
    }
    artist = artist.replace(/ - Topic$/i, '').replace(/VEVO$/i, '').trim();
    title = title
        .replace(/\s*[([](feat|ft|with|official|lyrics?|audio|video|remaster|hd|hq)[^)\]]*[)\]]/gi, '')
        .replace(/\s+-\s+(remaster(ed)?|single|radio edit|live)[^-]*$/i, '')
        .trim();
    return {title, artist};
}

// Synced lyrics from lrclib.net. Sends artist/title/duration of the playing track.
export class LyricsService {
    constructor(session) {
        this._session = session;
        this._cache = new Map();
        this._cancel = null;
    }

    async fetch(meta) {
        const {title, artist} = cleanMeta(meta);
        if (!title)
            return null;
        const dur = meta.length > 0 ? Math.round(meta.length / 1e6) : 0;
        const key = `${artist}|${title}|${dur}`;
        if (this._cache.has(key))
            return this._cache.get(key);
        this._cancel?.cancel();
        const cancel = new Gio.Cancellable();
        this._cancel = cancel;
        const base = 'https://lrclib.net/api';

        const tryGet = async params => {
            try {
                const j = await httpGetJson(this._session, `${base}/get?${enc(params)}`, cancel);
                const l = parseLrc(j.syncedLyrics ?? '');
                return l.length ? l : null;
            } catch (_e) {
                return null;
            }
        };
        const trySearch = async params => {
            try {
                const arr = await httpGetJson(this._session, `${base}/search?${enc(params)}`, cancel);
                const synced = (Array.isArray(arr) ? arr : []).filter(x => x.syncedLyrics);
                if (!synced.length)
                    return null;
                synced.sort((a, b) => Math.abs((a.duration ?? 0) - dur) - Math.abs((b.duration ?? 0) - dur));
                const l = parseLrc(synced[0].syncedLyrics);
                return l.length ? l : null;
            } catch (_e) {
                return null;
            }
        };

        let lines = await tryGet({track_name: title, artist_name: artist, album_name: meta.album, duration: dur || undefined});
        if (!lines && !cancel.is_cancelled())
            lines = await tryGet({track_name: title, artist_name: artist});
        if (!lines && !cancel.is_cancelled())
            lines = await trySearch({track_name: title, artist_name: artist});
        if (!lines && !cancel.is_cancelled())
            lines = await trySearch({q: `${artist} ${title}`.trim()});

        if (cancel.is_cancelled())
            return null;               // superseded: do not cache
        if (this._cache.size > 40)
            this._cache.delete(this._cache.keys().next().value);
        this._cache.set(key, lines);
        return lines;
    }

    destroy() {
        this._cancel?.cancel();
        this._cache.clear();
    }
}

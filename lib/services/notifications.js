import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Hooks every message-tray source and reports new notifications; optionally hides GNOME's own banners.
export class NotificationService {
    constructor(settings, onNotification) {
        this._s = settings;
        this._cb = onNotification;
        this._hooks = new Map();
        this._srcId = 0;
        this._prevBlocked = null;
    }

    start() {
        const tray = Main.messageTray;
        this._srcId = tray.connect('source-added', (_t, src) => this._hook(src));
        tray.getSources().forEach(s => this._hook(s));
        this.applyBannerPolicy();
    }

    _hook(src) {
        if (this._hooks.has(src))
            return;
        const a = src.connect('notification-added', (_s, n) => this._cb(n));
        const b = src.connect('destroy', () => this._hooks.delete(src));
        this._hooks.set(src, [a, b]);
    }

    applyBannerPolicy() {
        const tray = Main.messageTray;
        const hide = this._s.get_boolean('hide-default-banner');
        if (hide && this._prevBlocked === null) {
            this._prevBlocked = tray.bannerBlocked;
            tray.bannerBlocked = true;
        } else if (!hide && this._prevBlocked !== null) {
            tray.bannerBlocked = this._prevBlocked;
            this._prevBlocked = null;
        }
    }

    destroy() {
        const tray = Main.messageTray;
        if (this._prevBlocked !== null) {
            tray.bannerBlocked = this._prevBlocked;
            this._prevBlocked = null;
        }
        if (this._srcId)
            tray.disconnect(this._srcId);
        for (const [src, ids] of this._hooks) {
            for (const id of ids) {
                try { src.disconnect(id); } catch (_e) { /* gone */ }
            }
        }
        this._hooks.clear();
        this._srcId = 0;
    }
}

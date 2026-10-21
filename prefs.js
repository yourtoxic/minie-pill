import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function spinRow(settings, key, title, min, max, step = 1, subtitle = '', digits = 0) {
    const row = new Adw.SpinRow({
        title, subtitle, digits,
        adjustment: new Gtk.Adjustment({lower: min, upper: max, step_increment: step, page_increment: step * 5}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function colorRow(settings, key, title) {
    const row = new Adw.ActionRow({title});
    const btn = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog({with_alpha: true}), valign: Gtk.Align.CENTER});
    const rgba = new Gdk.RGBA();
    if (rgba.parse(settings.get_string(key)))
        btn.set_rgba(rgba);
    btn.connect('notify::rgba', () => settings.set_string(key, btn.get_rgba().to_string()));
    row.add_suffix(btn);
    row.activatable_widget = btn;
    return row;
}

function fontRow(settings, key, title, subtitle) {
    const row = new Adw.ActionRow({title, subtitle});
    const btn = new Gtk.FontDialogButton({dialog: new Gtk.FontDialog(), valign: Gtk.Align.CENTER, use_font: true});
    const cur = settings.get_string(key);
    if (cur)
        btn.set_font_desc(Pango.FontDescription.from_string(cur));
    btn.connect('notify::font-desc', () => {
        const fd = btn.get_font_desc();
        if (fd)
            settings.set_string(key, fd.to_string());
    });
    const reset = new Gtk.Button({icon_name: 'edit-undo-symbolic', valign: Gtk.Align.CENTER, tooltip_text: 'Use the default font'});
    reset.connect('clicked', () => settings.set_string(key, ''));
    row.add_suffix(reset);
    row.add_suffix(btn);
    return row;
}

function comboRow(settings, key, title, values, labels) {
    const row = new Adw.ComboRow({title, model: Gtk.StringList.new(labels)});
    row.selected = Math.max(0, values.indexOf(settings.get_string(key)));
    row.connect('notify::selected', () => settings.set_string(key, values[row.selected]));
    return row;
}

export default class MiniePillPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.set_default_size(680, 760);

        // ---- General
        const general = new Adw.PreferencesPage({title: 'General', icon_name: 'preferences-system-symbolic'});
        const g1 = new Adw.PreferencesGroup({title: 'Pill'});
        g1.add(switchRow(settings, 'always-visible', 'Always visible', 'Off: pill hides when nothing is active'));
        g1.add(switchRow(settings, 'popup-on-click', 'Open popup when the pill is clicked', 'Off: clicking the pill does nothing (notifications / Bluetooth picker still react)'));
        g1.add(switchRow(settings, 'scroll-switch', 'Scroll to switch activity', 'While music plays, scroll changes volume; Shift + scroll switches activity'));
        general.add(g1);
        const g2 = new Adw.PreferencesGroup({title: 'Clock'});
        g2.add(switchRow(settings, 'clock-always', 'Always show time when idle'));
        g2.add(switchRow(settings, 'clock-24h', '24-hour format'));
        g2.add(switchRow(settings, 'clock-seconds', 'Show seconds'));
        g2.add(spinRow(settings, 'clock-font-size', 'Clock text size (px)', 0, 72, 1, '0 = same size as the rest of the pill'));
        g2.add(fontRow(settings, 'clock-font', 'Clock font', 'Any installed font (its size is ignored, use the size above)'));
        general.add(g2);
        const g3 = new Adw.PreferencesGroup({title: 'Reset'});
        const reset = new Gtk.Button({label: 'Reset all settings', css_classes: ['destructive-action'], halign: Gtk.Align.START});
        reset.connect('clicked', () => {
            for (const k of settings.list_keys())
                settings.reset(k);
        });
        g3.add(reset);
        general.add(g3);
        window.add(general);

        // ---- Appearance
        const look = new Adw.PreferencesPage({title: 'Appearance', icon_name: 'applications-graphics-symbolic'});
        const a1 = new Adw.PreferencesGroup({title: 'Size'});
        a1.add(spinRow(settings, 'pill-height', 'Height (px)', 22, 64));
        a1.add(spinRow(settings, 'pill-top-margin', 'Distance from top (px)', 0, 60));
        a1.add(comboRow(settings, 'width-mode', 'Width', ['dynamic', 'fixed'], ['Dynamic (fits content)', 'Fixed']));
        a1.add(spinRow(settings, 'fixed-width', 'Fixed width (px)', 80, 640, 10));
        a1.add(spinRow(settings, 'font-size', 'Font size (px)', 9, 26));
        a1.add(spinRow(settings, 'content-offset-x', 'Nudge content horizontally (px)', -12, 12, 1, 'If text / icons look off-centre on your font'));
        a1.add(spinRow(settings, 'content-offset-y', 'Nudge content vertically (px)', -12, 12, 1));
        a1.add(spinRow(settings, 'pill-roundness', 'Roundness (%)', 0, 100, 5, '100 = full capsule, lower = squarer'));
        a1.add(spinRow(settings, 'panel-width', 'Popup width (px)', 360, 900, 10, 'Also adjustable with the − / + buttons inside the popup'));
        a1.add(spinRow(settings, 'panel-height', 'Popup height (px)', 240, 760, 10));
        look.add(a1);
        const a2 = new Adw.PreferencesGroup({title: 'Colours'});
        a2.add(colorRow(settings, 'bg-color', 'Background'));
        a2.add(colorRow(settings, 'text-color', 'Text'));
        a2.add(colorRow(settings, 'accent-color', 'Accent'));
        a2.add(switchRow(settings, 'border-enabled', 'Border'));
        a2.add(colorRow(settings, 'border-color', 'Border colour'));
        a2.add(spinRow(settings, 'border-width', 'Border width (px)', 1, 4));
        look.add(a2);
        const ad = new Adw.PreferencesGroup({title: 'Status dot', description: 'Tip: click the dot in the pill to move it left / middle / right'});
        ad.add(comboRow(settings, 'dot-mode', 'Show dot', ['always', 'mic', 'off'], ['Always', 'Only while the microphone is in use', 'Never']));
        ad.add(comboRow(settings, 'dot-position', 'Position', ['left', 'middle', 'right', 'custom'], ['Left', 'Middle (top edge)', 'Right', 'Custom offset']));
        ad.add(colorRow(settings, 'dot-color', 'Colour'));
        ad.add(spinRow(settings, 'dot-size', 'Size (px)', 4, 16));
        ad.add(spinRow(settings, 'dot-inset', 'Distance from pill edge (px)', 0, 60, 1, 'Left / right position only'));
        ad.add(spinRow(settings, 'dot-offset-x', 'Custom offset X (px from centre)', -500, 500, 2));
        ad.add(spinRow(settings, 'dot-offset-y', 'Custom offset Y (px)', -40, 40, 1));
        look.add(ad);
        const a3 = new Adw.PreferencesGroup({title: 'Motion'});
        a3.add(spinRow(settings, 'animation-speed', 'Animation speed (%)', 30, 300, 10));
        a3.add(spinRow(settings, 'spring-mass', 'Spring mass', 0.2, 5, 0.1, 'Heavier = slower, more inertia', 1));
        a3.add(spinRow(settings, 'spring-stiffness', 'Spring stiffness', 60, 2000, 10, 'Higher = snappier, expands faster'));
        a3.add(spinRow(settings, 'spring-damping', 'Spring damping', 2, 120, 1, 'Lower = more bounce (overshoot)'));
        a3.add(spinRow(settings, 'corner-smoothing', 'Squircle corner smoothing (%)', 0, 100, 5, '0 = plain round corner'));
        look.add(a3);
        window.add(look);

        // ---- Activities
        const act = new Adw.PreferencesPage({title: 'Activities', icon_name: 'view-list-symbolic'});
        const b1 = new Adw.PreferencesGroup({title: 'Show in pill'});
        b1.add(switchRow(settings, 'music-enabled', 'Music'));
        b1.add(switchRow(settings, 'lyrics-enabled', 'Synced lyrics', 'Sends artist/title of the playing track to lrclib.net'));
        b1.add(switchRow(settings, 'lyrics-in-pill', 'Current lyric line in pill'));
        b1.add(switchRow(settings, 'bt-enabled', 'Bluetooth devices'));
        b1.add(switchRow(settings, 'wifi-enabled', 'Wi-Fi'));
        b1.add(switchRow(settings, 'dnd-enabled', 'Do Not Disturb indicator'));
        b1.add(switchRow(settings, 'osd-enabled', 'Volume / brightness OSD', 'Replaces the on-screen popup'));
        b1.add(switchRow(settings, 'workspace-enabled', 'Workspace switch dots'));
        b1.add(switchRow(settings, 'download-enabled', 'Downloads', 'Browser temp files (.crdownload, .part) + network speed'));
        b1.add(switchRow(settings, 'download-net-enabled', 'Detect downloads by network speed', 'Works for any app / folder (Brave, wget, apt …)'));
        b1.add(spinRow(settings, 'download-net-threshold', 'Network speed that counts as a download (KB/s)', 100, 100000, 100, 'Video streaming can also reach ~1500 KB/s'));
        const dl = new Adw.EntryRow({title: 'Extra download folder (optional)'});
        settings.bind('download-dir', dl, 'text', Gio.SettingsBindFlags.DEFAULT);
        b1.add(dl);
        b1.add(switchRow(settings, 'record-enabled', 'Screen recording status', "GNOME's built-in recorder (Ctrl+Shift+Alt+R / screenshot tool)"));
        b1.add(switchRow(settings, 'weather-in-pill', 'Weather', 'Temperature + condition (set city in Panel page)'));
        b1.add(switchRow(settings, 'status-badges', 'Badges for DND / caffeine / airplane mode', 'Small icons at the left of the pill'));
        act.add(b1);
        const b2 = new Adw.PreferencesGroup({title: 'Notifications'});
        b2.add(switchRow(settings, 'notif-enabled', 'Show notifications in pill'));
        b2.add(switchRow(settings, 'hide-default-banner', 'Hide default GNOME banners'));
        b2.add(spinRow(settings, 'notification-width', 'Popup width (px)', 220, 760, 10));
        b2.add(spinRow(settings, 'notification-height', 'Popup height (px)', 40, 220, 2));
        b2.add(spinRow(settings, 'notification-font-size', 'Popup text size (px)', 10, 26));
        act.add(b2);
        const bc = new Adw.PreferencesGroup({title: 'Cat', description: 'Every N seconds a cat runs across the pill and hides everything else; then the previous view returns'});
        bc.add(switchRow(settings, 'cat-enabled', 'Enable cat'));
        bc.add(spinRow(settings, 'cat-interval', 'Appear every (seconds)', 5, 3600, 5));
        bc.add(spinRow(settings, 'cat-speed-min', 'Slowest speed (px/s)', 30, 1200, 10, 'Each run picks a random speed between slowest and fastest'));
        bc.add(spinRow(settings, 'cat-speed-max', 'Fastest speed (px/s)', 30, 1200, 10));
        bc.add(comboRow(settings, 'cat-direction', 'Direction', ['alternate', 'ltr', 'rtl', 'random'], ['Alternate each time', 'Left to right', 'Right to left', 'Random']));
        bc.add(comboRow(settings, 'cat-style', 'Cat', ['random', 'walker', 'runner', 'prowler', 'hopper', 'chaser', 'butterfly', 'fish', 'skater', 'duo'], ['Random (a different cat each time)', 'Walking cat', 'Running cat', 'Stalking cat', 'Hopping cat', 'Cat chasing a mouse', 'Cat chasing a butterfly', 'Cat following a fish', 'Skateboarding cat', 'Cat with a kitten']));
        bc.add(comboRow(settings, 'cat-effect', 'Effect', ['random', 'none', 'paws', 'sparkles', 'hearts', 'dust', 'speed'], ['Random', 'None', 'Paw prints', 'Sparkles', 'Hearts', 'Dust puffs', 'Speed lines']));
        bc.add(switchRow(settings, 'cat-interval-jitter', 'Randomise timing', 'Interval varies between 50% and 150%'));
        bc.add(spinRow(settings, 'cat-width', 'Pill width while running (px)', 200, 900, 10));
        const now = new Adw.ActionRow({title: 'Show the cat now', subtitle: 'Preview with current settings'});
        const go = new Gtk.Button({label: 'Run', valign: Gtk.Align.CENTER});
        go.connect('clicked', () => settings.set_int('cat-trigger', settings.get_int('cat-trigger') + 1));
        now.add_suffix(go);
        bc.add(now);
        act.add(bc);
        const b3 = new Adw.PreferencesGroup({title: 'Timing'});
        b3.add(spinRow(settings, 'instant-duration', 'OSD duration (ms)', 500, 8000, 100));
        b3.add(spinRow(settings, 'status-duration', 'Bluetooth / Wi-Fi / DND popup (ms)', 1000, 10000, 100));
        act.add(b3);
        window.add(act);

        // ---- Panel
        const panel = new Adw.PreferencesPage({title: 'Panel', icon_name: 'view-app-grid-symbolic'});
        const c1 = new Adw.PreferencesGroup({title: 'Clipboard (kept in memory only)'});
        c1.add(switchRow(settings, 'clipboard-enabled', 'Clipboard history'));
        c1.add(spinRow(settings, 'clipboard-max', 'History size', 5, 100));
        panel.add(c1);
        const c2 = new Adw.PreferencesGroup({title: 'Calendar & timer'});
        c2.add(switchRow(settings, 'week-start-monday', 'Week starts on Monday'));
        c2.add(spinRow(settings, 'timer-minutes', 'Default timer (minutes)', 1, 600));
        panel.add(c2);

        const w = new Adw.PreferencesGroup({title: 'Weather', description: 'Data from open-meteo.com (no account needed)'});
        const city = new Adw.EntryRow({title: 'Search city'});
        const status = new Adw.ActionRow({title: 'Location', subtitle: settings.get_string('weather-name') || 'Not set'});
        const find = new Gtk.Button({label: 'Find', valign: Gtk.Align.CENTER});
        city.add_suffix(find);
        const doFind = () => {
            const q = city.get_text().trim();
            if (!q)
                return;
            status.subtitle = 'Searching…';
            const session = new Soup.Session({timeout: 10});
            const msg = Soup.Message.new('GET',
                `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`);
            session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                try {
                    const bytes = s.send_and_read_finish(res);
                    const j = JSON.parse(new TextDecoder().decode(bytes.toArray()));
                    const r = j.results?.[0];
                    if (!r)
                        throw new Error('No match');
                    const name = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
                    settings.set_string('weather-name', name);
                    settings.set_double('weather-lat', r.latitude);
                    settings.set_double('weather-lon', r.longitude);
                    status.subtitle = name;
                } catch (e) {
                    status.subtitle = `Failed: ${e.message}`;
                }
            });
        };
        find.connect('clicked', doFind);
        city.connect('entry-activated', doFind);
        w.add(city);
        w.add(status);
        w.add(comboRow(settings, 'weather-units', 'Units', ['metric', 'imperial'], ['Metric (°C, km/h)', 'Imperial (°F, mph)']));
        panel.add(w);
        window.add(panel);
    }
}

<h1 align="center">Minie Pill</h1>
<p align="center">A Dynamic-Island style pill for the GNOME Shell top bar.<br>Clock, music + synced lyrics, notifications, Bluetooth, Wi-Fi, downloads, screen recording, a spring-physics popup, and a cat that runs across it.</p>

<p align="center">
  <img alt="GNOME Shell" src="https://img.shields.io/badge/GNOME%20Shell-49%20%7C%2050-4A86CF">
  <img alt="Wayland" src="https://img.shields.io/badge/Wayland-ready-green">
  <img alt="License" src="https://img.shields.io/badge/license-add%20yours-lightgrey">
</p>

<p align="center"><img src="docs/media/hero.gif" alt="Hero GIF" ></p>
<p align="center"><sub><i>Hero GIF — the pill expanding, showing music, a notification, then the cat</i></sub></p>

---

## Contents
- [Features](#features)
- [Install](#install)
- [How to use it](#how-to-use-it)
- [Popup tabs](#popup-tabs)
- [Settings](#settings)
- [Cats](#cats)
- [Performance](#performance)
- [Troubleshooting](#troubleshooting)
- [Credits](#credits)

---

## Features

### Look and motion
- Pure black squircle shape drawn with Cairo (adjustable roundness + corner smoothing), crisp 1-px ring border.
- Spring physics (mass / stiffness / damping). The pill stretches, overshoots, settles; if interrupted it keeps its momentum.
- Content fades out, pill resizes, new content fades in.
- Custom colours (background, text, accent, border), height, width (dynamic or fixed), font size.

<p align="center"><img src="gif/bounce.gif" alt="Spring animation GIF" ></p>
<p align="center"><sub><i>Spring animation GIF — slow it down so the bounce is visible</i></sub></p>

### Clock
HH:MM:SS, 12 / 24 hour, seconds on/off, **custom text size and any installed system font**.

<p align="center"><img src="gif/clock.gif" alt="Clock screenshot" ></p>
<p align="center"><sub><i>Clock screenshot</i></sub></p>

### Music
- Works with any MPRIS player (Spotify, Brave / Chrome tabs, Firefox, VLC, ...).
- Album art, title, artist, animated bars.
- **Synced lyrics** in the pill (from [lrclib.net](https://lrclib.net)). Turn it off in settings if you do not want track names sent.
- Scroll over the pill while music plays to change the volume.

<p align="center"><img src="gif/music.gif" alt="Music + lyrics GIF"></p>
<p align="center"><sub><i>Music + lyrics GIF</i></sub></p>
<p align="center"><img src="gif/music_volume.gif" alt="Scroll-to-change-volume GIF"></p>
<p align="center"><sub><i>Scroll-to-change-volume GIF</i></sub></p>

### Notifications
Every notification (system, apps, browsers) pops up in the pill. Width, height, text size and duration are all adjustable. Click it to open the app. GNOME's own banners can be hidden.

<p align="center"><img src="gif/notification.gif" alt="Notification GIF"></p>
<p align="center"><sub><i>Notification GIF</i></sub></p>

### Bluetooth, Wi-Fi, Do Not Disturb
- **Bluetooth**: device type icon (earbuds / headphones / mouse / keyboard / speaker / phone / gamepad), name, battery as icon and text. Several devices connected? Click the pill to pick which one to show. "No device connected" when Bluetooth is on and idle.
- **Wi-Fi**: network name + signal icon (display only).
- **Do Not Disturb**: badge in the pill while it is on.

<p align="center"><img src="gif/bluetooth.gif" alt="Bluetooth GIF"></p>
<p align="center"><sub><i>Bluetooth GIF</i></sub></p>
<p align="center"><img src="gif/wifi.png" alt="Wi-Fi screenshot"></p>
<p align="center"><sub><i>Wi-Fi screenshot</i></sub></p>
<p align="center"><img src="gif/dnd.png" alt="DND badge screenshot"></p>
<p align="center"><sub><i>DND badge screenshot</i></sub></p>

### Instant popups
Volume, brightness, workspace switch dots, timer, Bluetooth connect / disconnect. They appear instantly, then the pill goes back to what it was showing.

<p align="center"><img src="gif/volume.gif" alt="Volume GIF"></p>
<p align="center"><sub><i>Volume GIF</i></sub></p>
<p align="center"><img src="gif/brightness.gif" alt="Brightness GIF"></p>
<p align="center"><sub><i>Brightness GIF</i></sub></p>
<p align="center"><img src="gif/timer.gif" alt="Timer GIF"></p>
<p align="center"><sub><i>Timer GIF</i></sub></p>

### Weather, downloads, screen recording
- **Weather**: temperature + condition (Open-Meteo, no account).
- **Downloads**: browser downloads in your Downloads folder (name, size, speed) plus a network-speed detector for any app.
- **Screen recording**: pulsing red dot + timer for GNOME's built-in recorder. Click to stop.

<p align="center"><img src="gif/weather.png" alt="Weather screenshot"></p>
<p align="center"><sub><i>Weather screenshot</i></sub></p>
<p align="center"><img src="gif/download.gif" alt="Download GIF"></p>
<p align="center"><sub><i>Download GIF</i></sub></p>
<p align="center"><img src="gif/screenrecord.gif" alt="Screen recording GIF""></p>
<p align="center"><sub><i>Screen recording GIF</i></sub></p>

### Badges and the green dot
- Small icons at the left of the pill for **Do Not Disturb**, **Caffeine** (keep awake) and **Airplane mode**.
- iOS-style **green dot** shown while the microphone is in use. Move it: left / middle / right / custom offset, or just click it to hop between positions.

<p align="center"><img src="gif/caffeine.png" alt="Caffeine badge"></p>
<p align="center"><sub><i>Caffeine badge</i></sub></p>
<p align="center"><img src="gif/green_dot.gif" alt="Green dot GIF"></p>
<p align="center"><sub><i>Green dot GIF</i></sub></p>

### Cats
Every N seconds a cat takes over the pill and runs across it, then the previous view returns. Nine cats, seven effects, random speed, direction control. See [Cats](#cats).

<p align="center"><img src="gif/cat.gif" alt="Cats GIF"></p>
<p align="center"><sub><i>Cats GIF</i></sub></p>

---

## Install

```bash
unzip minie-pill-*.zip
cd minie-pill@toxic
chmod +x install.sh
./install.sh
```

On Wayland, log out and back in once after the first install or after updating.

Needs GNOME Shell 49 or 50. Optional: `pactl` (microphone detection fallback), `wpctl` / `pactl` (volume fallback).

Bluetooth battery not showing? Enable BlueZ experimental mode:

```bash
sudo sed -i 's/^#\?Experimental.*/Experimental = true/' /etc/bluetooth/main.conf
sudo systemctl restart bluetooth
```

---

## How to use it

| Action | Result |
|---|---|
| **Click** the pill | Open the popup (can be turned off in settings) |
| **Click outside** the popup / **Esc** | Close it |
| **Scroll** while music plays | Change volume |
| **Scroll** otherwise | Switch between running activities |
| **Shift + scroll** | Always switch activity |
| **Right-click** | Next activity |
| **Middle-click** | Play / pause |
| **Click the green dot** | Move it left / middle / right |
| **Ctrl + scroll** over the popup | Resize the popup |

---

## Popup tabs

The popup grows out of the pill (the pill hides while it is open).

| Tab | What it does |
|---|---|
| Home | Player: art, lyrics, seek bar, controls (clock + date when nothing plays) |
| Calendar | Month view, week starts Sunday or Monday |
| Weather | Now + 5 day forecast |
| Apps | Search and launch applications |
| Clipboard | Text history, pin, delete (kept in memory only) |
| File shelf | Hold files: copy in the file manager, press "Paste files" |
| Controls | Volume, brightness, Wi-Fi, Bluetooth, DND, Night Light, dark style, caffeine, airplane, lock |
| Timer | Countdown with presets, shown in the pill |

<p align="center"><img src="docs/media/popup-home.png" alt="Home tab" width="720"></p>
<p align="center"><sub><i>Home tab</i></sub></p>
<p align="center"><img src="docs/media/popup-calendar.png" alt="Calendar tab" width="720"></p>
<p align="center"><sub><i>Calendar tab</i></sub></p>
<p align="center"><img src="docs/media/popup-weather.png" alt="Weather tab" width="720"></p>
<p align="center"><sub><i>Weather tab</i></sub></p>
<p align="center"><img src="docs/media/popup-apps.png" alt="Apps tab" width="720"></p>
<p align="center"><sub><i>Apps tab</i></sub></p>
<p align="center"><img src="docs/media/popup-clipboard.png" alt="Clipboard tab" width="720"></p>
<p align="center"><sub><i>Clipboard tab</i></sub></p>
<p align="center"><img src="docs/media/popup-shelf.png" alt="File shelf tab" width="720"></p>
<p align="center"><sub><i>File shelf tab</i></sub></p>
<p align="center"><img src="docs/media/popup-controls.png" alt="Controls tab" width="720"></p>
<p align="center"><sub><i>Controls tab</i></sub></p>
<p align="center"><img src="docs/media/popup-timer.png" alt="Timer tab" width="720"></p>
<p align="center"><sub><i>Timer tab</i></sub></p>

---

## Settings

`gnome-extensions prefs minie-pill@toxic`

| Page | Highlights |
|---|---|
| General | Always visible, popup on click, scroll behaviour, clock options (24h, seconds, size, font), reset |
| Appearance | Size, roundness, corner smoothing, colours, border, popup size, status dot, spring mass / stiffness / damping |
| Activities | Which activities show, notification size and time, downloads, screen recording, **cat** options |
| Panel | Clipboard, calendar, timer, weather city and units |

<p align="center"><img src="docs/media/prefs-general.png" alt="Settings: General" width="720"></p>
<p align="center"><sub><i>Settings: General</i></sub></p>
<p align="center"><img src="docs/media/prefs-appearance.png" alt="Settings: Appearance" width="720"></p>
<p align="center"><sub><i>Settings: Appearance</i></sub></p>
<p align="center"><img src="docs/media/prefs-activities.png" alt="Settings: Activities" width="720"></p>
<p align="center"><sub><i>Settings: Activities</i></sub></p>
<p align="center"><img src="docs/media/prefs-panel.png" alt="Settings: Panel" width="720"></p>
<p align="center"><sub><i>Settings: Panel</i></sub></p>

---

## Cats

| Cat | |
|---|---|
| Walking | classic side-view walk |
| Running | gallop |
| Stalking | low crouch |
| Hopping | sitting cat that hops |
| Chasing a mouse | cat + mouse |
| Chasing a butterfly | cat + flapping butterfly |
| Following a fish | cat + fish |
| Skateboarding | sitting cat on a board |
| Cat with a kitten | mother + small kitten |

**Effects:** paw prints, sparkles, hearts, dust puffs, speed lines, none, or random.
**Cat = Random** picks a different cat every time. Speed is random between your slowest and fastest value. Direction: left to right, right to left, alternate, random. "Run" in settings previews it.

<p align="center"><img src="docs/media/cat-effects.gif" alt="Cat effects GIF" width="720"></p>
<p align="center"><sub><i>Cat effects GIF</i></sub></p>

---

## Performance

The extension runs inside `gnome-shell`, so there is no separate process. To see the real cost on your machine:

```bash
tools/measure-usage.sh 60
```

It compares `gnome-shell` RAM and CPU with the extension off and on. Run it again while music plays or the cat is visible.

Lightest setup: dot mode "Never", clipboard off, network download detection off.

---

## Troubleshooting

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i minie
```

| Problem | Try |
|---|---|
| Settings window error about `gschemas.compiled` | `glib-compile-schemas ~/.local/share/gnome-shell/extensions/minie-pill@toxic/schemas` |
| Download not detected | Settings, Activities: add the folder, or keep network detection on |
| Content looks off-centre | Settings, Appearance: nudge content X / Y |
| Green dot never shows | Dot mode must be "Only while the microphone is in use" or "Always" |
| Brightness popup missing | Check `ls /sys/class/backlight` |

---

## Credits

- Weather: [Open-Meteo](https://open-meteo.com)
- Lyrics: [lrclib.net](https://lrclib.net)
- Made by **&lt;your name&gt;**
- License: **&lt;add a license&gt;**

## Changelog

- **v6**: popup on/off, random cat, 4 new cats, cat effects, centred bars, multi-backlight support
- **v5**: screen recording, download fallback, dot fix, call volume-bar fix
- **v4**: squircle + crisp border, cats, downloads, mic dot
- **v3**: status dot, clock font, bluetooth icons
- **v1-v2**: first release

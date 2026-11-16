# Configuration: `calm-tv.json`

Everything specific to a home lives in one JSON file, so the same app works on any TV.
A complete example is [`config/calm-tv.example.json`](../config/calm-tv.example.json).
The TypeScript definition, which is the source of truth, is `CalmTvConfig` in [`src/config.ts`](../src/config.ts).

## Where the TV finds it

Each time Calm TV starts, it looks in this order:

1. **Home Assistant's `www` folder**, served at `http://<ha>/local/calm-tv.json`.
   *This is the recommended place.* Edit the file in Home Assistant, for example with the
   **File editor** or **Studio Code Server** add-on, then reopen Calm TV or choose
   Settings → Home setup → OK. No computer, no rebuild.
   - Create the folder `/config/www/` if it doesn't exist. Home Assistant only serves `/local/` after
     a **restart** that happens once `www` exists.
   - Files in `www` can be read by anyone on your network without signing in. This file only
     names entities, but don't put anything secret in it.
2. **A file on the TV**, pushed from a computer:
   ```bash
   adb push calm-tv.json /sdcard/Android/data/io.github.neocarlos.hacalmtv/files/calm-tv.json
   ```
   Open Calm TV once first, so that folder exists. This is handy before you've set up a way to edit
   Home Assistant's files.
3. **The last copy that worked**, kept by the app. A typo in the newest file, or Home Assistant
   being down at start-up, won't blank the screen.

Settings → **Home setup** shows which source was used, how many rooms it has, and any error, such as
`room "Kitchen" needs "groups": [ … ]`.

In the **desktop browser preview** (`npm run dev`), the file is read from the project folder
(`./calm-tv.json`). That makes it the easiest place to edit and preview before copying the file to HA.

The **Home Assistant address** isn't in this file, because the TV needs it to find the file. It's set
on the TV, on the first-run screen or with adb, and in `.env.local` for the browser preview. See
[tv-setup.md](tv-setup.md).

## The format

All keys are optional. A file with just `{}` gives a working screen with no rooms and the
default app dock.

```jsonc
{
  "apps": [ … ],          // the dock
  "weather": "weather.home",
  "calendar": { "events": "calendar.family", "meals": "calendar.meal_plan" },
  "doorbell": { "window": false, "camera": "camera.front_door", "ringing": "input_boolean.doorbell_ringing" },
  "rooms": [ … ],         // the Smart Home bar
  "display": { "glass": "blur", "videos": true, "transitions": "fade" },
  "sky": { "sun": "sun.sun" },   // the living sky: time of day and weather on the background
  "backgrounds": { "photos": [ … ], "videos": [ … ] }
}
```

### `apps`: the dock, in order

```json
{ "name": "Netflix", "icon": "netflix", "package": "com.netflix.ninja" }
```

- `package`: the Android TV app's package name. Find it with
  `adb shell pm list packages`, or on the app's Play Store page URL (`id=…`).
- `icon`: optional. Either a built-in icon's name, or your own file.
  - **Built in** (the file names in `src/icons/`, without `.svg`):
    - Streaming: `youtube`, `netflix`, `primevideo`, `disneyplus`, `hulu`, `appletv`, `peacock`,
      `googletv`, `hbomax`, `paramountplus`, `crunchyroll`, `tubi`, `youtubekids`, `twitch`
    - Media servers: `plex`, `jellyfin`, `emby`, `kodi`, `stremio`
    - Music: `spotify`, `youtubemusic`, `applemusic`, `tidal`
    - Games: `steam`, `nvidia` (GeForce NOW), `playstation`
    - Smart home: `homeassistant`
  - **Your own file**, with no rebuild: put an SVG or PNG in Home Assistant's `www` folder and give
    its path, e.g. `"icon": "/local/calm-tv/icons/moonlight.svg"` (or a full `https://` address).
    It's shown as a white silhouette like the built-in icons, so a one-colour logo on a transparent
    background works best. [Simple Icons](https://simpleicons.org) (CC0) has thousands.
  - Without an icon, the tile shows the app's name.
- Apps that aren't installed on the TV are hidden automatically.
- Leave `apps` out entirely for a default lineup of common streaming apps.

### `screens`: which screens, in which order

```json
"screens": ["apps", "smarthome", "weather"]
```

- The four screens are `apps`, `smarthome`, `calendar` and `weather`. ↓ moves through them in the
  order listed. This example has no Calendar.
- `apps` is always shown, and always first: it holds Settings. If you leave it out, it's added back.
- A screen you leave out isn't loaded at all (no calendar or forecast requests).
- Leave `screens` out for all four, in the order above.

### `weather`

A Home Assistant weather entity. **Open-Meteo** is recommended: it gives about 7 days of hourly
forecast. Met.no, Home Assistant's default, only gives 48 hours, so the hour chart is empty from
the third day on. Defaults to `weather.home`.

### `calendar`

- `events`: the calendar shown in the Calendar screen's bar, covering the next 14 days and up to 24 events.
- `meals`: optional. Today's all-day event from this calendar becomes "Dinner · …" under the date.
  A leading "Dinner:" in the event title is dropped.

Any Home Assistant calendar works: Google Calendar, CalDAV, Local Calendar, or Remote Calendar
(an ICS link). Leave `calendar` out and Calm TV guesses: a calendar with "meal" in its id is meals,
and one with "event" in its id is events.

### `doorbell`

```json
{ "window": true, "camera": "camera.front_door", "ringing": "input_boolean.doorbell_ringing" }
```

When `window` is true, a small live video of `camera` appears in the corner while `ringing` is
on, **even over other apps**. You need an automation that turns the input_boolean on when the doorbell
rings; see [home-assistant.md](home-assistant.md). Google TV already shows its own alert for Nest
doorbells, so this is off by default.

Three optional extras change how it appears:

```json
{ "window": true, "camera": "camera.front_door", "ringing": "input_boolean.doorbell_ringing",
  "size": 75, "position": "center", "pause": true, "sound": true }
```

- `size`: the window's width as a percentage of the screen, 20 to 100. Default `34`, about a third.
- `position`: `"corner"` (top right, the default) or `"center"`.
- `pause`: `true` pauses whatever another app is playing when the doorbell rings, like pressing the
  remote's pause button. It doesn't restart it; press play when you're done. Default `false`.
- `sound`: `true` plays the camera's audio once live video starts. Default `false` (silent).
  Cameras whose audio isn't WebRTC-friendly (e.g. AAC) stay silent unless Home Assistant's go2rtc
  converts it to Opus.

The window shows a picture within a second or so from Home Assistant's camera proxy (MJPEG, or
snapshots in a row), then switches to live WebRTC video once its first frame is drawn. If live video
never connects, the quick picture stays.

While the window is over another app, **Back** closes it (and doesn't reach the app underneath).
It also closes by itself when `ringing` turns off.

### `music`: the Music panel

```json
{
  "players": [
    { "name": "Living room", "entity": "media_player.living_room" },
    { "name": "Kitchen", "entity": "media_player.kitchen" }
  ]
}
```

With `music` in the file, a **Music** tile appears at the end of the dock, next to Settings (or wherever an `apps` entry
`{ "name": "Music", "open": "music" }` puts it). It opens a panel with what the chosen speaker is
playing (art, title, progress), play/pause, previous/next, volume and grouping, the speakers, and
a row of library buttons (Artists, Albums, Tracks, Playlists, Radio, Podcasts, Audiobooks). Each button opens a grid you can browse
into (an artist's albums, an album's tracks, with "Play all") and play from, on the chosen speaker. Made for **Music Assistant**, but it only uses Home
Assistant's media player services and media browser, so other players work too.

- `players`: the speakers, in order. Leave it out to list every Music Assistant player.
- `library`: which of the media browser's top folders get a button, by exact name, in this order.
  Default `["Artists", "Albums", "Tracks", "Playlists", "Radio", "Podcasts", "Audiobooks"]` (Music
  Assistant's), so Home Assistant's other media sources (cameras, text-to-speech…) stay out.

### `rooms`: the Smart Home bar, in order

```jsonc
{
  "name": "Living room",
  "icon": "couch",                 // couch, cutlery, desk, bed, stairs, house
  "whenIdle": "All off · curtains closed",  // the summary when nothing is on (default "All off")
  "locks": ["lock.front_door"],    // room turns amber if one is left unlocked 10+ minutes
  "maintenance": "sensor.living_room_maintenance", // optional: a short "needs attention" text sensor
  "alert": { "entity": "binary_sensor.garage_door", "text": "Garage open" }, // urgent while on
  "vacuum": { "label": "Vacuum", "vacuum": "kitchen_vacuum", "dock": "kitchen_vacuum_dock" },
  "groups": [
    { "title": "Lights", "devices": [ { "type": "light", "entity": "light.floor_lamp", "name": "Floor lamp" } ] }
  ]
}
```

What the room card says, in priority order:
1. **Urgent** (amber): the `alert` is on, a lock has been left unlocked, or the vacuum has a problem.
2. **Maintenance** (amber): the `maintenance` sensor's text, if it isn't empty or unknown.
3. **What's on**: "2 lights on · 1 window open".
4. Otherwise, `whenIdle`.

#### Devices

Each device is `{ "type", "entity", "name" }` plus a few optional extras:

| `type` | Entity | On the TV |
| --- | --- | --- |
| `light` | `light.*` | On/off. Dimmable lights get a brightness slider |
| `switch` | `switch.*` (plugs) | On/off |
| `cover` | `cover.*` | Open/close curtains or blinds. Optional `"batteries": ["sensor.…"]` shows the lowest |
| `climate` | `climate.*` | Thermostat with set point. The first one in any room is also shown large on the Smart Home screen |
| `scene` | `select.*` whose options are scenes (e.g. from the Hue integration) | A scene picker |
| `camera` | `camera.*` that supports WebRTC (Nest, go2rtc, most modern integrations) | Live video |
| `lock` | `lock.*` | **Status only**, like "Locked (Keypad) · 93% battery". Optional `batteries`, `operator` (a sensor saying how it was locked), `keypad` (a keypad battery sensor) |
| `sensor` | `sensor.*` or `binary_sensor.*` | Status only: a value with its unit, Open/Closed, or "Someone there"/"Clear" for occupancy sensors |

`name` defaults to the entity id. Entity ids are listed in Home Assistant under Settings → Devices &
services → Entities.

#### Robot vacuums

`vacuum` uses the **Roborock** integration's entity naming. `"vacuum": "kitchen_vacuum"` reads
`sensor.kitchen_vacuum_status`, `sensor.kitchen_vacuum_battery`,
`binary_sensor.kitchen_vacuum_water_shortage` and `sensor.kitchen_vacuum_vacuum_error`.
`"dock"` reads the dock's `binary_sensor.<dock>_clean_water_box`, `_dirty_water_box` and
`_cleaning_fluid`, and `sensor.<dock>_dock_error`. Missing sensors are skipped. Other brands would need small changes in
`vacuumProblems()` in `src/home-data.ts`.

### `display`: look options

```json
{ "glass": "blur", "videos": true, "transitions": "fade" }
```

These are **defaults for every TV**. Each TV can override any of them in **Settings → Performance**,
whose rows say whether a value is the default, from calm-tv.json, or set on this TV. *Reset to calm-tv.json* there undoes a
TV's own changes.

- `glass`: how the bars along the bottom look.
  - `"blur"` (the default): frosted glass that blurs the background behind it. Over a photo this is
    free, because the blur is pre-computed. Over a video it's a live blur, which costs a few frames per
    second while switching screens on a TV.
  - `"tint"`: plain dark glass with no blur. The lightest option, and the same darkness as the frosted bars.
- `videos`: `true` (the default) shows a looping video background, and Settings → Background offers
  videos; `false` shows a photo, and the picker offers photos. Each kind remembers its own choice,
  so turning videos off and on again returns to the same clip.
- `transitions`: how screens change. `"fade"` (the default) cross-fades; `"instant"` switches with no
  animation, the lightest option on slow devices.

### `sky`: the living sky

```json
{ "sky": {} }
```

With `sky` in the file, the background follows the real time of day and the weather:

- **Time of day** from the sun's height (`sun`, default `sun.sun`), so dawn and dusk arrive with the
  real sunrise and sunset and blend in gradually. Any photo or video gets a code-only look: warmer at
  dawn and dusk, darker and bluer at night, with stars in the open sky when it's clear. A background
  whose name says when it was made ("…Sunset", "…Night") isn't tinted toward that time again.
- **Weather** from `weather` (default the `weather` entity above): rain, heavier rain when it pours,
  snow, low fog, drifting cloud shadows and the odd lightning flash, drawn by the app over any
  background. `"effects": false` keeps the time of day without them.
- **Versions for each time of day:** a background can come in four versions, named
  `NN-name.dawn.jpg`, `NN-name.day.jpg`, `NN-name.dusk.jpg` and `NN-name.night.jpg` (or `.mp4`) in
  `src/wallpapers/` or `src/videos/`. They show as one background, and the version for the time of
  day replaces the code-only look. From Home Assistant, add `"dawn"`, `"dusk"` and `"night"` addresses
  next to `"url"` in `backgrounds` below.

Without `sun.sun`, a rough day from the clock is used. To preview it in a browser:
`?demo&sky=night&wx=snowy` (times: `dawn`, `day`, `dusk`, `night`; any Home Assistant weather condition).

### `backgrounds`: extra photos and videos

```json
{
  "photos": [{ "name": "Our beach", "url": "/local/calm-tv/beach.jpg" }],
  "videos": [{ "name": "Fireplace", "url": "/local/calm-tv/fireplace.mp4", "thumb": "/local/calm-tv/fireplace.jpg" }]
}
```

With [`sky`](#sky-the-living-sky), each can also have `"dawn"`, `"dusk"` and `"night"` versions:
`{ "name": "Our beach", "url": "/local/calm-tv/beach.jpg", "night": "/local/calm-tv/beach-night.jpg" }`.

Paths starting with `/` are on Home Assistant (its `www` folder is `/local/`). Full `http(s)://`
addresses also work. They're added after the built-in backgrounds in Settings → Background.

- **Photos:** about 2560 px wide and landscape.
- **Videos:** 1080p H.264 MP4, no audio, ideally under 20 MB, made with the `ffmpeg` command in
  [`src/videos/README.md`](../src/videos/README.md). Videos from Home Assistant stream from it
  each time they loop. Built-in ones are loaded into memory once.

## After editing

- **File in Home Assistant:** reopen Calm TV, or Settings → Home setup → OK.
- **File on the TV:** push it again, then reopen Calm TV.
- **Browser preview:** just reload the page.

If something doesn't show, check Settings → Home setup for an error, and make sure each entity id
exists in Home Assistant. A device whose entity doesn't exist shows "Unavailable".

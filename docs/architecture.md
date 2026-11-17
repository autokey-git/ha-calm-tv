# Architecture

```
 Google TV
 ┌─────────────────────────────────────────────────────────────┐
 │ Calm TV (Android app, android/)                         │
 │  MainActivity ── full-screen WebView                        │
 │     │  serves the built page from the app's own files at    │
 │     │  http://appassets.androidplatform.net/assets/web/     │
 │     │  JS bridge: window.CalmTvNative (NativeBridge.kt)  │
 │     │  ConfigFile.kt: fetches calm-tv.json              │
 │  HomeButtonService ── accessibility service: Home → us,      │
 │                       draws the doorbell overlay             │
 │  ┌─────────────── web page (src/) ───────────────┐           │
 │  │ main.ts → config → home-data/apps → app.ts    │           │
 │  │ sections: Apps · Smart Home · Calendar · Weather│         │
 │  └──────────────────────┬────────────────────────┘           │
 └─────────────────────────┼───────────────────────────────────┘
                           │ websocket (states, services, forecasts,
                           │ calendar events, WebRTC camera offers)
                    Home Assistant  (+ /local/calm-tv.json)
```

## The web page (`src/`)

Plain TypeScript and DOM, built with Vite. There's no framework, so it stays small and readable.

- **Start-up (`main.ts`):** `loadConfig()` reads the HA address and `calm-tv.json`
  (`config.ts`). `loadHome()` turns rooms into `Zone`/`Device` objects (`home-data.ts`), and
  `loadApps()` builds the dock (`apps.ts`). Then `new CalmTv().start()` (`app.ts`). If no HA
  address is saved, the first-run screen (`setup.ts`) appears on top.
- **Stage:** a fixed 1920×1080 canvas scaled to the screen. All CSS uses those coordinates.
  Background layers sit at the bottom: two photo layers for cross-fades, a `<video>`, film grain, and
  shading. The four sections are stacked on top and **cross-fade**; they don't slide.
- **Sections** (`sections/*.ts`) implement `Section` (`count`, `focus`, `blur`, `activate`).
  `app.ts` routes the remote: Up/Down picks a section and Left/Right moves within it. Items carry
  `data-item`, so a tap or click on one does what OK does. Overlays (room detail, settings, Music,
  background picker, setup) take the keys while open.
- **Input in the panels (`focus.ts`):** every overlay uses one `FocusGroup`. A panel marks what can
  be focused with `data-focus="<id>"` and gives each item a click listener for what it does. The group
  does the rest: the arrows move to the nearest item that way (by where things are on screen), OK
  clicks the focused item, a tap or click focuses then acts, and Back calls the panel. So the remote,
  touch and a mouse always do the same thing, and a new panel works all three ways without extra code.
  Keys that change a value instead of moving (a dimmer's ←/→, the thermostat's ↑/↓) go in `onKey`.
  Wording that names a remote key lives in `hints.ts`, next to its touch version.
- **The Home Assistant dashboard (`?dash`):** the same app for a touch screen (see
  [dashboard.md](dashboard.md)). `dashboard-bar.ts` adds a tab bar under the stage instead of the Apps screen;
  everything else is shared. Inside a dashboard, `ha.ts` uses Home Assistant's own sign-in.
- **Home Assistant (`ha.ts`):** uses `home-assistant-js-websocket`.
  - OAuth sign-in through HA's login page; tokens are kept in `localStorage`, tied to the HA address.
  - `subscribeEntities` keeps every state live. `app.ts` copies them into rooms with `applyStates()`, and
    `summarize()` makes each room card's line.
  - Controls call services, e.g. `light.turn_on` and `select.select_option`.
  - Weather uses `weather/subscribe_forecast`, daily and hourly.
  - Calendars use `calendar.get_events` with `return_response`, every 5 minutes.
  - Cameras use `camera/webrtc/offer` (`camera-stream.ts`), the same handshake HA's own frontend uses.
- **Outside data is decoded where it enters** (Valibot): `ha-data.ts` for Home Assistant's entity
  attributes, forecasts and calendar events; `config.ts` for `calm-tv.json`; `state.ts` for saved
  settings. A field that arrives missing or malformed becomes `undefined` instead of breaking a screen.
  `dom.ts` holds the checked element lookups.
- **Backgrounds:** photos in `src/wallpapers/` and clips in `src/videos/` are found automatically at
  build time. More can be listed in the config. The choice is remembered in `localStorage`.

## The Android app (`android/`)

- **`MainActivity`:** the home activity (it has the `HOME` intent filter). It hosts the WebView, serves the
  built page with `WebViewAssetLoader` over **http**, so the page may reach an http Home Assistant.
  It only lets the WebView navigate to the page itself and to the configured Home Assistant,
  for its login page. It maps Back to Escape, and tells the page when it's paused or resumed. It accepts
  `--es haUrl …`, and in debug builds `--es devUrl …`.
- **`NativeBridge`** (`window.CalmTvNative`): list and launch installed apps, open TV settings,
  switch to Google's home, the HA address, `loadConfig()`, and the doorbell overlay.
- **`ConfigFile`:** fetches `http://<ha>/local/calm-tv.json` natively, because HA doesn't send
  CORS headers for `/local` and the page couldn't read it. Falls back to the file in the app's external
  files folder.
- **`HomeButtonService`:** an accessibility service. It catches the Home key, replaces Google's home
  screen if it appears, and draws the **doorbell overlay** (`DoorbellOverlay`) over other apps. An
  accessibility overlay needs no "display over other apps" permission.
- **`NoPosterChromeClient`:** hides Android's grey play-button placeholder behind videos that
  haven't started.
- **`Prefs`:** the HA address, and the "using Google's home" switch.

## Project layout

| Path | What it is |
| --- | --- |
| `index.html` | The stage: background layers, section track, overlays |
| `src/main.ts` | Start-up: loads the config, then builds the screens |
| `src/config.ts` | `calm-tv.json`: its schema, loading, the HA address |
| `src/ha.ts` | Home Assistant connection: OAuth sign-in, live states, service calls |
| `src/ha-data.ts` | Schemas that decode HA attributes, forecasts and calendar events |
| `src/app.ts` | The orchestrator: sections, remote input, backgrounds, HA wiring |
| `src/focus.ts`, `src/hints.ts` | The panels' shared input (remote, touch and mouse); remote and touch wording |
| `src/dashboard-bar.ts` | The dashboard's tab bar (`?dash`) |
| `src/home-data.ts` | Rooms built from the config, and how HA states become status lines |
| `src/apps.ts` | The app dock (config `apps`, or a built-in default lineup) |
| `src/sections/` | One file per screen, plus room detail, settings, background picker |
| `src/setup.ts` | The first-run "Connect to Home Assistant" screen |
| `src/camera-stream.ts`, `src/doorbell.ts` | Live camera video over WebRTC; the optional doorbell window |
| `src/demo.ts`, `src/demo-remote.ts` | Demo mode (`?demo`, and always in the hosted demo): a made-up home standing in for Home Assistant, plus an on-screen remote on touch screens |
| `src/dom.ts`, `src/state.ts` | Checked element lookups; settings remembered between starts |
| `src/wallpapers/`, `src/videos/`, `src/icons/`, `src/fonts/` | Built-in photos, clips, app icons and the Manrope font |
| `src/style.css` | All styling, in 1920×1080 stage coordinates |
| `android/` | The Android TV app: WebView, Home-button service, JS bridge, config loader |
| `config/calm-tv.example.json` | A complete example home |

## Adding things

- **A new device type:**
  1. Add it to `DeviceType` (`types.ts`) and `DEVICE_TYPES` (`config.ts`).
  2. Read its state in `applyDevice()` (`home-data.ts`).
  3. Draw and control it in `sections/zone-detail.ts`.
  4. Document it in `docs/configuration.md`.
- **A new screen:** implement `Section` in `sections/`, then add it to `this.sections` in `app.ts`.
- **A new panel:** create a `FocusGroup` on its element, mark its items with `data-focus`, and put
  each item's action in a click listener. Then `npm test` (`scripts/smoke-test.mjs`) can check it: add
  a few steps that open and use it with the remote and with taps.
- **A new config option:**
  1. Add it to `CalmTvConfig` (`config.ts`), with validation if a mistake would break the screen.
  2. Read it via `settings.config`.
  3. Add it to `config/calm-tv.example.json` and `docs/configuration.md`.

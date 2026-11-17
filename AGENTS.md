# Notes for AI coding agents

You're helping someone run **HA Calm TV** (the app is called Calm TV on the TV), a Google TV home screen driven by Home Assistant, in
*their* home. Read `README.md`, then the docs in `docs/`, before changing code.

## The key idea

The app is **generic**. Everything about a home is in `calm-tv.json` ([docs/configuration.md](docs/configuration.md)),
and the Home Assistant address is stored on the TV. **Most adaptation is editing that JSON, not code.**
Change code only for things the config can't express: new device types, a different vacuum brand, new
screens, design changes. Don't hard-code a home's entities or addresses into `src/` or `android/`.

## Suggested plan with the user

Follow [docs/getting-started.md](docs/getting-started.md):

1. **Config:** copy `config/calm-tv.example.json` to `./calm-tv.json` and fill it with their
   entities.
   - Ask what rooms and devices they care about on a TV; don't dump every entity in.
   - If they give you a Home Assistant token, list entities with `GET /api/states`. Use the token only on
     their machine; never write it into the project.
2. **Browser preview:** add `.env.local` with `VITE_HA_URL=…`, run `npm install` and `npm run dev`, and let them
   sign in. Fix "Unavailable" devices, which mean wrong entity ids, and check Settings → Home Assistant → Home setup.
3. **Home Assistant:** set up the TV user, Open-Meteo, calendar refresh, and a place for the config
   ([docs/home-assistant.md](docs/home-assistant.md)).
4. **TV:** follow [docs/tv-setup.md](docs/tv-setup.md): adb, install, home screen, address, sign-in, config.
5. **Then customize:** backgrounds, design, new features.

## Commands

```bash
npm install
npm run dev               # browser preview; reads ./calm-tv.json and .env.local
npm run typecheck         # run after every change
npm run tv:apk            # needs JAVA_HOME (JDK 17+) and the Android SDK (ANDROID_HOME or android/local.properties)
npm run tv:install        # build + install on the adb-connected TV
adb logcat -s CalmTV  # TV logs
```

To check the TV's page, open `chrome://inspect` with adb connected (debug builds).

## Conventions

- **Plain TypeScript and DOM, no framework.** All CSS is in `src/style.css`, on a fixed 1920×1080 stage.
- **Decode outside data where it enters, with Valibot schemas.** Home Assistant attributes, forecasts and
  calendar events (`src/ha-data.ts`), `calm-tv.json` (`src/config.ts`), saved settings (`src/state.ts`)
  and the TV bridge's answers. After that, code works with typed values: no `typeof` checks, no `as`
  casts, no `Record<string, unknown>`.
- **Look up the screens' own markup with `child()` / `find()`** (`src/dom.ts`), not `querySelector(...) as …`.
- **Remote first:** every action must work with arrows, OK and Back. The mouse is a bonus.
- **Calm design:** few elements, generous spacing, status text over badges. Ask before adding clutter.
- **Keep comments plain and explain why.** Update `docs/` when behavior or config changes.

## Guardrails

- **Never commit or embed secrets.** No HA tokens, passwords or long-lived tokens in code, config or docs.
  The TV signs in through HA's own login page.
- **Locks, garage doors and vacuums may be controlled, but never by accident.** A single press, a
  bumped remote or a repeating key must not unlock a lock or move a door: ask for a deliberate second
  press on the same item, never act on a state that's unknown, stop (not reverse) a door that's
  moving, and say so when Home Assistant refuses.
- **Keep the WebView locked down.** `MainActivity` may only navigate to the page and the configured HA.
  Don't widen it, and never expose `CalmTvNative` to other sites.
- **Controls act on the real house.** When testing with the user's HA, avoid toggling things they
  didn't ask you to; reading states is fine.
- **`adb shell settings put secure enabled_accessibility_services`** replaces the whole list. Read it
  first and append. It's a security setting on the user's TV: leave turning it on to them.
- **Every install switches the Home button service off** (Android turns an accessibility service off
  when its app is updated). After `tv:install`, tell the user to turn it back on (TV Settings → System
  → Accessibility → Calm TV: Home button), or Home, the doorbell window, door pop-ups and ★ stop working.
  Keys sent with `adb shell input keyevent` never reach the service either, so test ★ with a real remote.
- **Performance:** test animations and video on the TV itself. See [docs/lessons-learned.md](docs/lessons-learned.md)
  before changing transitions, blur or video handling.

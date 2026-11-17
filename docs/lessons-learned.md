# Lessons learned

Things that went wrong or surprised us while building Calm TV on a real Google TV, and what
fixed them. Read this before changing animations, video, the Android side or the HA connection.

## Google TV and Android

- **The Home button ignores the chosen home app.** Google TV routes Home to its own launcher. Setting
  Calm TV as the home activity isn't enough; the accessibility service (`HomeButtonService`) catches
  Home, and also replaces Google's `HomeActivity` the moment it appears.
- **Serve the page over http, not https.** A page loaded from `https://appassets.androidplatform.net`
  can't open websockets to an `http://` Home Assistant (mixed content). `setHttpAllowed(true)` plus
  `usesCleartextTraffic` solve it.
- **Lock the WebView down.** It may only navigate to Calm TV's own page and the configured Home
  Assistant, for its login page. The JS bridge must never be reachable from other sites.
- **The grey play icon behind videos** is Android's default video poster. A `WebChromeClient` whose
  `getDefaultVideoPoster()` returns a transparent pixel removes it everywhere.
- **Pause video when not in front.** The activity tells the page (`ct-pause`/`ct-resume`), so a
  video background never runs behind Netflix or the screensaver.
- **The built page lives inside the APK** (`assets/web`). `npm run build` doesn't update it;
  `npm run build:android` does.
- **adb into `Android/data`:** let the app create its external files folder first, by opening it once.
  A folder created by adb may not be readable by the app.

## Performance on a TV

- **Don't slide whole screens.** Moving a full 1920×1080 layer stuttered on the TV, and it
  dragged a darkening gradient along visibly. Sections now **cross-fade**: the old one out quickly,
  then the new one in.
- **Blur is costly over video.** The frosted bars over a photo use a pre-blurred copy of the photo,
  which is cheap. Over a video they need `backdrop-filter`, a live blur, which costs ~8 fps during
  section fades: 52 fps instead of 60, still acceptable at rest. Keep the blur radius small (10px). If a TV struggles, `"display": { "glass": "tint" }` in the config drops the blur entirely.
- **Video backgrounds:** 1080p H.264, no audio, under ~20 MB. Bigger buys nothing on a 1080p UI.
  Clips bundled in the app are loaded fully into memory (blob URL) before playing, because the app's
  file server is unreliable at seeking and looping straight from the APK. Clips from Home Assistant can't be
  read that way (CORS), so they stream directly.
- **Measure on the TV, not the computer.** Remote-debug the WebView (`chrome://inspect`) and count frames with
  `requestAnimationFrame` and `video.getVideoPlaybackQuality()`.

## Home Assistant

- **Sign in with OAuth, not tokens in code.** `home-assistant-js-websocket`'s `getAuth` opens HA's
  login page and returns to the app. Use a separate non-admin user for the TV.
- **Don't let one OK sign you out.** A panel that opens with a destructive row focused, plus a remote
  OK that's held or pressed twice, signs people out without them noticing, and it then looks like the
  app "forgot" the sign-in. Signing out takes two presses, OK presses in the first moment after a panel
  opens are ignored, and held-down OK never repeats an action.
- **One step to set up.** Typing the HA address leads straight into HA's login page, instead of asking
  people to find a sign-in button afterwards.
- **Nest cameras have no snapshots or MJPEG,** only WebRTC. `camera-stream.ts` does the same
  `camera/webrtc/offer` handshake as HA's frontend. Nest wants transceivers in the order audio,
  video, then a data channel. Streams can take several seconds; say so on screen.
- **Remote Calendar (ICS) refreshes only every 24 hours.** Add an automation that calls
  `homeassistant.update_entity` on it every 15 minutes.
- **ICS feeds lose colors.** Per-event colors from the source calendar don't survive the ICS export.
- **Open-Meteo stamps daily forecasts at midnight UTC,** which is the afternoon before, in US time zones.
  Read the date as written, not as a local time. Late in the day Open-Meteo has no "today" entry, so
  the Weather screen builds Today from current conditions plus the remaining hours.
- **Met.no gives only 48 hours** of hourly forecast; Open-Meteo gives ~7 days.
- **All-day calendar events end on the next day** (exclusive end). Events with only a start time come
  with `end == start`.
- **Hue doesn't report the active scene,** so a scene picker can't show which one is on, only
  what you last picked.
- **HA's `/local/` doesn't send CORS headers,** so the page can't fetch files from it. The Android app
  fetches the config natively instead.

## Design choices that held up

- **Calm over complete.** Few rooms, few devices per room, status lines instead of badges. Only add a
  device if its status is useful from the couch.
- **Locks, garage doors and vacuums can be controlled, but never by accident.** A remote gets bumped,
  sat on and repeats keys, so a single press never unlocks a lock or moves a door: it takes a deliberate
  second press on the same item. Nothing acts on a state it can't read, a moving door is stopped rather
  than reversed, and a refusal from Home Assistant is shown.
- **A dark gradient behind the top half** of the Smart Home, Calendar and Weather screens keeps white text
  readable on bright photos.
- **The Weather chart shows a moving window:** now plus the next 8 hours for Today, and 6 AM–10 PM every 2
  hours for other days.
- **The Calendar bar groups events into day columns** under a small month grid, which rings the focused
  event's day.

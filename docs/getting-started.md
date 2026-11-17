# Getting started: from zero to your TV

Each step gives you something working before the next one. If you're working with an AI agent,
do this together; [`AGENTS.md`](../AGENTS.md) tells the agent the same plan.

## 1. Describe your home (30–60 minutes)

1. Copy `config/calm-tv.example.json` to `calm-tv.json` in the project folder.
2. Replace the example rooms with yours. A quick way to collect entity ids is
   Settings → Devices & services → Entities in Home Assistant, filtered by area.
   - Start small: two rooms with a few lights each. Add cameras, locks and scenes later.
   - An agent can help here. Paste it the entity list, or let it read the list from HA's API with a token you
     create, and ask it to draft the rooms. Review the result; you decide what's worth showing on a TV.
3. Set `weather` and `calendar`, and trim `apps` to what you actually use.

See [configuration.md](configuration.md) for every option.

## 2. Try it in a browser (15 minutes)

To look around first, run `npm install` and `npm run dev`, then open http://localhost:5173/?demo.
That's a made-up home with sample calendar and weather, and no Home Assistant needed.

Then point it at your own home:

```bash
npm install
echo "VITE_HA_URL=http://<your-ha>:8123" > .env.local
npm run dev
```

Open http://localhost:5173, then press ↓ to the Smart Home screen → OK on the Home Assistant card → sign in.
Walk through each screen with the arrow keys. Fix entity ids that show "Unavailable".
Check Settings (the gear at the end of the dock) → Home Assistant → Home setup for config errors.

## 3. Get Home Assistant ready

Follow [home-assistant.md](home-assistant.md):
- A non-admin user for the TV.
- Open-Meteo for weather.
- Calendar refresh, if you use an ICS calendar.
- Somewhere to keep `calm-tv.json`: HA's `www` folder is best.

## 4. Put it on the TV

Follow [tv-setup.md](tv-setup.md):
1. Connect adb.
2. Install the APK.
3. Make it the home screen.
4. Enter HA's address.
5. Sign in.
6. Give it `calm-tv.json`.

## 5. Make it yours

- **Backgrounds:** your own photos and looping videos. Add them to `src/wallpapers/` and
  `src/videos/` and rebuild, or list files from HA's `www` folder under `backgrounds` in the config.
- **Look and feel:** everything is in `src/style.css`, laid out on a fixed 1920×1080 stage.
- **New kinds of devices or screens:** see [architecture.md](architecture.md), and read
  [lessons-learned.md](lessons-learned.md) before changing animations, video or the Android side.

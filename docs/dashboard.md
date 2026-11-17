# Calm TV as a Home Assistant dashboard

The same app runs on a wall or kitchen tablet, as a dashboard inside Home Assistant's own app. Add
`?dash` to its address and it switches to touch:

- A **tab bar** along the bottom with the time, a tab per screen (Home, Calendar, Weather), what's
  playing, Music and Settings. There's no Apps screen: a web page can't open other apps.
- **Everything is tapped**: rooms, devices, scenes, calendar events, days. Swipe up or down to change
  screens.
- **Dimmers are dragged**, a light's name switches it, and the thermostat has − and + buttons. Tap
  outside a control to close it.
- The screens keep the TV's layout, scaled to the screen, with the bar in the room a 16:10 screen has
  left over.

Try it in a browser first: [localhost:5173/?demo&dash](http://localhost:5173/?demo&dash), or the
[live demo](https://neocarlos.github.io/ha-calm-tv/?dash) (once this is released).

## Put it in Home Assistant

1. **Publish the app into Home Assistant's `www` folder.** With the
   [File editor](https://github.com/home-assistant/addons/tree/master/configurator) app installed and
   started, and an administrator's
   [long-lived access token](https://www.home-assistant.io/docs/authentication/#your-account-profile)
   in `~/.config/homeassistant/token`:

   ```sh
   HA_URL=http://homeassistant.local:8123 npm run publish:ha
   ```

   It builds the app, re-encodes any background clip over Home Assistant's 16 MB upload limit (needs
   ffmpeg), and copies everything to `www/calm-tv/`. Run it again after any change. Prefer to copy
   by hand? `npm run build`, then put the contents of `dist/` in `www/calm-tv/` (with Samba or SSH).

2. **Add a dashboard** in Home Assistant: Settings → Dashboards → Add dashboard → **Webpage**, with
   the address `/local/calm-tv/index.html?dash`. Or, in a dashboard's raw configuration:

   ```yaml
   views:
     - title: Calm TV
       type: panel
       cards:
         - type: iframe
           url: /local/calm-tv/index.html?dash
           aspect_ratio: 100%
   ```

   With [Kiosk Mode](https://github.com/NemesisRE/kiosk-mode) installed, add
   `kiosk_mode: { hide_header: true, hide_sidebar: true }` to fill the screen.

3. **Open it.** Inside a dashboard Calm TV uses Home Assistant's own sign-in, so there's
   nothing more to sign in to. It reads the same `calm-tv.json` as the TV.

**Browsers keep www files for a month.** `npm run publish:ha` puts a new `&v=…` on the address in any
dashboard that shows Calm TV, so they load the new version. If you copy files by hand, change
that `v` yourself.

Opened on its own (not in a dashboard), `…/local/calm-tv/index.html?dash` signs in with Home
Assistant's login page, like the TV.

## Good to know

- Everything in `www` can be opened by anyone who can reach your Home Assistant, without signing in.
  That includes `calm-tv.json` (entity ids, room names) and your background clips. Fine on a home
  network or VPN; think twice if your Home Assistant is open to the internet.
- Album art in the Music panel comes from Music Assistant's own address. If the device can't reach
  that machine directly (for example behind a router's device isolation), the art stays blank;
  everything else still works.

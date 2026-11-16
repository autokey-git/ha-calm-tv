# HA Calm TV

A calmer home screen for Google TV, driven by Home Assistant. A photograph (or a slow looping
video), the time, your apps, and your home: lights, curtains, thermostat, cameras, calendar and
weather, all made for the TV remote.

![The Apps screen over a looping video of a mountain lake at sunset: clouds drift and the water ripples behind a frosted, live-blurred dock of streaming apps](docs/images/calm-tv-motion.webp)

*The video background and live blur, recorded from the browser preview.*

**[Try the live demo](https://neocarlos.github.io/ha-calm-tv/)** in your browser: a made-up home, no Home
Assistant needed. Use the arrow keys, Enter and Escape, or the on-screen remote on a phone.

I built this for one TV, a Google TV Streamer in my living room, and I'm sharing it as a starting
point to build on. Nothing about my home is in the code: each TV reads its rooms, apps and calendars
from a small `calm-tv.json` file, so you can adapt it without touching the app.

## What it does

These are recorded from the app's demo mode, with a made-up home, so you can try every one of them
in a browser yourself (see [Try the interface](#try-the-interface)). They're shown over a still
photo to keep them small; the video backgrounds are at the top and under
[Make it yours](#make-it-yours).

### Your home at a glance

Each room shows what's on, and turns amber when something needs you: a door left unlocked, the
garage open, a vacuum out of water. Open a room to switch and dim its lights with the remote; the
change goes straight to Home Assistant.

![Moving across the rooms on the Smart Home screen, opening the living room and brightening the ceiling light step by step; the room then reads "3 lights on"](docs/images/demo-smart-home.webp)

### Thermostat and scenes

The indoor temperature is the big number on the Smart Home screen; open the thermostat in its room
to change the set point with ↑ and ↓. Scenes (from Hue, or any `select` entity) are a short list to
pick from.

![Raising the kitchen thermostat from 68° to 70°, then choosing the Relax scene for the office](docs/images/demo-thermostat-and-scenes.webp)

### Cameras

Cameras play live, over WebRTC through Home Assistant, the same way its own dashboard does (in the
demo, a placeholder doorbell view). An optional doorbell window can pop up over whatever you're
watching.

![Opening the Outside room and its doorbell camera's live view](docs/images/demo-cameras.webp)

### Calendar

Today's date, tonight's dinner from a meal-plan calendar, and the next two weeks of events. The month
grid rings the day of the event you're on, and shades trips that span several days.

![Stepping through the coming events; the ring in the month calendar follows each one, and a three-day cabin weekend is shaded](docs/images/demo-calendar.webp)

### Weather

A week from Home Assistant's forecast. Each day opens into hour-by-hour temperatures with the chance
of rain.

![Stepping from today through the week, from sunny days into two rainy ones, with the hourly bars changing each time](docs/images/demo-weather.webp)

### Make it yours

Photos or slow looping videos behind everything, with the bars frosted over them. Add your own, or
use the two made for the project.

![Opening Settings, then switching the video background from a mountain lake at sunset to a forest brook and back](docs/images/demo-backgrounds.webp)

## Built for the Google TV Streamer

HA Calm TV was built and tested on the **Google TV Streamer (2024)**: MediaTek MT8696, 4 GB of RAM,
Android TV 14. That hardware is the reason it can afford the nicest parts of the design:

- **Live blur:** the frosted bars blur whatever is moving behind them, including a video.
- **Looping video backgrounds**, decoded in hardware and kept running behind the screens.

On the Streamer that holds 60 fps at rest, dipping to about 52 fps while switching screens over a
video. Other Google TV and Android TV devices (Android 12 or newer) should run it, but I haven't
tried any, and cheaper ones with less memory, like the Chromecast with Google TV, may struggle.

You can check on your own TV: **Settings → Performance** has switches for video backgrounds,
frosted glass and screen transitions, and a frame-rate counter, so
you can flip a setting and see the difference straight away. Each TV keeps its own choices; to set
a default for every TV, use `display` in `calm-tv.json`. Your mileage may vary.

**Use it at your own risk.** It replaces the TV's home screen, and controls real devices in your
house. Try it in a browser first, then on the TV when you're ready; the setup guide explains how to
get back to Google's home screen at any time.

It started as a Home Assistant–driven take on [CleanFrame](https://github.com/nthnclrk/CleanFrame),
a lovely home screen for Samsung The Frame.

## Try the interface

You need Node.js 20 or newer.

```sh
git clone https://github.com/NeoCarlos/ha-calm-tv.git
cd ha-calm-tv
npm ci
npm run dev
```

Open [localhost:5173/?demo](http://localhost:5173/?demo) to try the whole app against a made-up
home (the same as the [live demo](https://neocarlos.github.io/ha-calm-tv/)): no Home Assistant needed. Its lights, scenes, curtains and thermostat respond, the cameras play
a clip, and the calendar and weather are filled with sample days. Use the arrow keys, Enter and
Escape, or the mouse.

To see your own home, copy `config/calm-tv.example.json` to `calm-tv.json`, fill in your entities,
and put `VITE_HA_URL=http://<your-ha>:8123` in a `.env.local` file. Then sign in from the Smart Home
screen.

There are four screens: **Apps**, **Smart Home**, **Calendar** and **Weather**. Move between them
with ↑ ↓. Settings is the gear at the end of the app dock.

## Use a coding agent

Most changes are a matter of editing `calm-tv.json`. For anything more, open this repo in a local
coding agent and give it a bounded task:

```text
Read AGENTS.md and the docs folder. Help me adapt HA Calm TV to my home.
My Home Assistant is at <address>. Start with my calm-tv.json and the
browser preview: <describe your rooms, or one change you want>.
Don't install anything on the TV or change its settings yet.
```

## Put it on a TV

Follow [docs/getting-started.md](docs/getting-started.md), then
[docs/tv-setup.md](docs/tv-setup.md): install the app, make it the home screen, point it at Home
Assistant and sign in once. [docs/home-assistant.md](docs/home-assistant.md) covers what Home
Assistant needs, and [docs/doorbell-and-music.md](docs/doorbell-and-music.md) sets up the
doorbell window and the Music panel with your own entities.

The [latest release](https://github.com/NeoCarlos/ha-calm-tv/releases/latest) has a ready-made APK,
so you can try it without building anything. It's a debug build; build your own from source for
anything long-term.

## More

- [Configuration](docs/configuration.md): every option in `calm-tv.json`
- [Architecture](docs/architecture.md): how the code fits together
- [Lessons learned](docs/lessons-learned.md): pitfalls already hit and solved
- [Third-party notices](THIRD_PARTY_NOTICES.md): fonts, icons and photos, and their licences

MIT licensed. See [LICENSE](LICENSE).

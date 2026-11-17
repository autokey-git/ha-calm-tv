# Third-party notices

The root [MIT licence](LICENSE) covers HA Calm TV's own code and documentation. The material below
keeps its own terms. Keep these notices, and the licence texts next to the files, when you share the
source or a build.

## CleanFrame

HA Calm TV began as a Home Assistant–driven take on
[CleanFrame](https://github.com/nthnclrk/CleanFrame), a calm home screen for Samsung The Frame: its
photograph-and-clock home, frosted dock, remote-first navigation and several of its icon files.
CleanFrame is under the MIT licence:

> Copyright (c) 2026 Nathan Clark
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
> NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
> OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
> CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Font

| Material | Terms |
| --- | --- |
| Manrope (`src/fonts/`), Latin and Latin Extended subsets from Google Fonts | SIL Open Font License 1.1, `src/fonts/MANROPE-OFL.txt`. © 2018 The Manrope Project Authors |

## Icons and trademarks

| Icons (`src/icons/`) | Source and terms |
| --- | --- |
| Apple TV, HBO Max, Netflix, Prime Video, Stremio, YouTube | [Simple Icons](https://github.com/simple-icons/simple-icons), CC0 1.0, by way of CleanFrame's icon set (files unchanged from CleanFrame). `src/icons/SIMPLE-ICONS-LICENSE.txt` |
| Google TV, Plex; and from Simple Icons 16.38.0: Apple Music, Crunchyroll, Emby, Home Assistant, Jellyfin, Kodi, NVIDIA, Paramount+, PlayStation, Spotify, Steam, TIDAL, Tubi, Twitch, YouTube Kids, YouTube Music | [Simple Icons](https://github.com/simple-icons/simple-icons), CC0 1.0 (files unchanged). `src/icons/SIMPLE-ICONS-LICENSE.txt` |
| Music Assistant (`musicassistant.svg`) | The logo path from [Music Assistant's frontend](https://github.com/music-assistant/frontend) (`public/favicon.svg`), Apache License 2.0; drawn as a one-colour silhouette. |
| Music panel library icons (in `src/sections/music-panel.ts`) | The icons Music Assistant's own sidebar uses: Albums, Tracks, Playlists, Audiobooks, Podcasts, Radio and Favourites from [Lucide](https://github.com/lucide-icons/lucide), ISC licence, `src/icons/LUCIDE-LICENSE.txt`; Artists and Genres from [Music Assistant's frontend](https://github.com/music-assistant/frontend) (`src/components/icons/`), Apache License 2.0. |
| Disney+ | [Custom Brand Icons](https://github.com/elax46/custom-brand-icons), MIT, by way of CleanFrame. `src/icons/CUSTOM-BRAND-ICONS-LICENSE.txt` |
| Settings gear | [Material Icons](https://github.com/google/material-design-icons) "settings", Apache License 2.0. `src/icons/MATERIAL-ICONS-LICENSE.txt` |
| Hulu, Peacock | Simplified marks drawn for this project, covered by its MIT licence |

Brand marks identify services. Their owners keep all trademark rights; this project claims no
endorsement by or affiliation with them, or with Home Assistant, Nabu Casa or the Open Home Foundation.

## Backgrounds

The included backgrounds, "Mountain Lake Sunset" and "Stylized Forest Brook" (the photos in
`src/wallpapers/`, the clips and thumbnails in `src/videos/`, and the README animation), were made for
this project with Google Flow and are covered by the project's MIT licence. So is the placeholder
doorbell view that demo mode's cameras show (`src/demo-media/doorbell-camera.mp4`), also made for
the project. No third-party photos or video
clips are included; `src/wallpapers/README.md` and `src/videos/README.md` explain how to add your own.

## Libraries

Bundled into the built app: [home-assistant-js-websocket](https://github.com/home-assistant/home-assistant-js-websocket)
(Apache 2.0) and [Valibot](https://github.com/fabian-hiller/valibot) (MIT) in the web page, and
[AndroidX WebKit](https://developer.android.com/jetpack/androidx/releases/webkit) (Apache 2.0) in the
Android app. Their licences ship with their packages. Build tools (TypeScript, Vite, Gradle) keep the
licences in their own packages.

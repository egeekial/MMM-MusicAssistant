# MMM-MusicAssistant

A [MagicMirror²](https://magicmirror.builders) module that shows **now-playing**
information from a [Music Assistant](https://music-assistant.io) server: artist,
album, song title, total length, elapsed/remaining time, a smooth progress bar, and
album art — plus a short "next up" list.

Inspired by [MMM-Mopidy-MPD](https://github.com/coderpussy/MMM-Mopidy-MPD), with a
refreshed look (blurred album-art background by default).

## Features

- Artist · song · album (album hidden automatically for radio streams)
- Total length, elapsed time and remaining time
- Smooth progress/slider bar that ticks locally every second (no network spam)
- Album / cover art from Music Assistant's image proxy
- Short **Next up** queue list
- **Pinned + auto-fallback** player selection: prefer your configured player, but
  automatically switch to any other player that is actively playing
- Hides itself when nothing is playing

## Screenshots

_(Add a screenshot here once running.)_

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/egeekial/MMM-MusicAssistant
cd MMM-MusicAssistant
npm install
```

## Getting a token

Music Assistant requires a **long-lived token** to connect to its API
(server schema version 28 and newer). Create one in the Music Assistant web UI under
**Settings → Security** (long-lived tokens), and paste it into the module config.

## Configuration

Add the module to the `modules` array in `~/MagicMirror/config/config.js`:

```js
{
  module: "MMM-MusicAssistant",
  position: "bottom_left",
  config: {
    serverUrl: "http://192.168.1.50:8095",
    token: "<long-lived token from Music Assistant>",
    player: "Living Room", // name or player_id; auto-falls back to any playing player
    layout: "background",
    showNextUp: true,
    maxNextUp: 3
  }
}
```

### Options

| Option                   | Type    | Default                   | Description |
| ------------------------ | ------- | ------------------------- | ----------- |
| `serverUrl`              | string  | `"http://localhost:8095"` | Base HTTP(S) URL of the Music Assistant server. |
| `token`                  | string  | `""`                      | Long-lived token (required for MA schema ≥ 28). |
| `player`                 | string  | `""`                      | Preferred player by `player_id` or display name. Auto-falls back to any playing player. Empty = always show whatever is playing. |
| `layout`                 | string  | `"background"`            | `"background"` (blurred art behind the card) or `"beside"` (art left, text right). |
| `showAlbum`              | boolean | `true`                    | Show the album line (always hidden for radio). |
| `showProgressBar`        | boolean | `true`                    | Show the progress bar and time labels. |
| `showNextUp`             | boolean | `true`                    | Show the "Next up" list. |
| `maxNextUp`              | number  | `3`                       | Max number of upcoming items to show. |
| `imageSize`              | number  | `512`                     | Requested album-art size (px) from the image proxy. |
| `imageBaseUrl`           | string  | `""`                      | Base URL used to build album-art links. Defaults to `serverUrl`. Set this only if the mirror's browser should load art from a different address than the API. |
| `hideWhenIdle`           | boolean | `true`                    | Collapse/hide the module when nothing is playing. |
| `updateProgressInterval` | number  | `1000`                    | Progress-bar tick interval (ms). |
| `animationSpeed`         | number  | `500`                     | Fade speed (ms) on track/state change. |

## How it works

The module's `node_helper` connects to the Music Assistant **WebSocket API**
(`ws://<host>:8095/ws`), authenticates with your token, and listens for queue/player
events. It resolves the active player, normalizes the now-playing data (including a
ready-to-load album-art URL), and pushes it to the frontend. The frontend renders the
card and advances the progress bar locally so it stays smooth and in sync.

No Python dependency — the only runtime dependency is [`ws`](https://www.npmjs.com/package/ws).

## Troubleshooting

- **Module stays hidden** — nothing is playing, or the `player` name/ID doesn't match.
  Try leaving `player` empty to show whatever is currently playing.
- **`Authentication failed` / `requires a token`** — set a valid long-lived `token`.
- **No album art** — album-art URLs are built from `serverUrl` (the address you
  configured) by default, so make sure that URL is reachable from the mirror's browser.
  If your art must load from a different host, set `imageBaseUrl`.
- Check the MagicMirror logs (`pm2 logs mm` or the terminal) for `[MMM-MusicAssistant]`
  lines.

## License

MIT

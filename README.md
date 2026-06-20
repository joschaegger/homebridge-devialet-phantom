# homebridge-devialet-phantom

A [Homebridge](https://homebridge.io) plugin that controls a **Devialet Phantom**
(Phantom I or II, single unit or stereo pair) via its local HTTP **IP Control
API** and exposes it in Apple Home as a **Television** accessory.

Supports:

- Switching source (AirPlay, optical, Bluetooth, Spotify Connect, Roon, UPnP, ...)
- Reading and setting volume (with a hard safety cap)
- Play / Pause (where the current source reports it as available)
- Reflecting changes made in the Devialet app (polling)

The plugin is dependency-free (uses Node's built-in `http`) and modular: all
device communication lives in [`src/devialetClient.js`](src/devialetClient.js).

## Requirements

- A Devialet Phantom on firmware **DOS 2.14+** (IP Control). This plugin was
  developed against **DOS 2.19.1**.
- The speaker reachable over HTTP on port 80 (no authentication).
- A **static IP** for the speaker (DHCP reservation strongly recommended).

Verify your speaker before installing:

```sh
curl -s http://<IP>/ipcontrol/v1/systems/current
```

This must return JSON. If it does not, the firmware is too old or the IP is wrong.

## Installation

### Option A - install directly from Git (no npm publish needed)

On the machine running Homebridge:

```sh
sudo npm install -g git+https://github.com/joschaegger/homebridge-devialet-phantom.git
sudo hb-service restart   # or: sudo systemctl restart homebridge
```

The plugin will not appear in the Homebridge UI plugin *search*, but it is fully
functional and its settings UI works (the `config.schema.json` ships in the
package).

### Option B - from npm (Homebridge UI store)

Once published to npm, search for **Devialet Phantom** in the Homebridge UI
Plugins tab and install it there.

## Configuration

Configure it in the Homebridge UI, or add a platform block to `config.json`:

```json
{
  "platforms": [
    {
      "platform": "DevialetPhantom",
      "name": "Phantom",
      "ip": "192.168.2.147",
      "pollInterval": 7,
      "maxVolume": 60,
      "defaultVolume": 35,
      "restoreVolumeOnSourceSwitch": true,
      "exposeVolumeAsLightbulb": false,
      "volumeStep": 2
    }
  ]
}
```

Multiple speakers: provide a `devices` array of these same objects instead of the
top-level `ip`.

| Field | Type | Default | Purpose |
|---|---|---|---|
| `name` | string | "Phantom" | Accessory name |
| `ip` | string | - | Static IP of the speaker (**required**) |
| `port` | int | 80 | IP Control HTTP port |
| `pollInterval` | int (s) | 7 | State polling interval |
| `maxVolume` | int | 60 | **Safety cap** - all volume values clamped to this |
| `defaultVolume` | int | 35 | Value applied after source switch / power-on |
| `restoreVolumeOnSourceSwitch` | bool | true | Counter the firmware reset-to-35 |
| `exposeVolumeAsLightbulb` | bool | false | Percentage slider in Apple Home |
| `volumeStep` | int | 2 | Step for the Remote widget up/down |
| `hideSources` | string[] | none | Source `type` values to hide from Apple Home (e.g. `["raat"]` to hide Roon) |
| `sources` | string[] | all | Advanced: show ONLY these `type`/`sourceId` values |

In the Homebridge UI, **hideSources** appears under "Sources" as a checkbox list -
just tick the ones you want hidden (e.g. Roon). Leaving everything unticked shows
all sources. `sources` (whitelist) is the inverse and lives under "Advanced"; use
one or the other.

## Safety: volume cap

The Phantom gets **painfully loud**. Every volume value - from the slider, Siri,
the Remote widget, and the volume-restore-after-source-switch logic - is
hard-clamped to `maxVolume` before it is sent to the speaker. The default cap is a
conservative `60`. Raise it deliberately.

## Apple Home quirks (important)

Because the speaker is a **Television** accessory, a few Apple Home behaviors are
expected and are HomeKit constraints, not bugs:

- **It pairs as a separate accessory.** TV accessories are published as external
  accessories. After installing, add it in the Home app via *Add Accessory ->
  More options* and your Homebridge PIN.
- **Volume lives in the Remote widget.** The standard volume up/down (and your
  iPhone's side buttons while the Remote is open in Control Center) control it.
  There is no volume slider on the TV tile itself.
- **Want a real slider?** Enable `exposeVolumeAsLightbulb`. A Lightbulb appears
  whose **brightness = volume**. Do not rename it to include the word "Volume" or
  Apple Home applies unwanted automatic behavior. (This plugin names it
  "<name> Pegel".)
- **Power button = play/pause.** This firmware's IP Control does not expose a
  confirmed standby toggle, so the TV power control is mapped to play/pause as a
  best-effort approximation. The accessory is shown as *active* whenever the
  speaker is reachable, and *inactive* when it is offline/unreachable.
- **Play/Pause** is only meaningful when the current source reports it. Some
  sources (e.g. raw AirPlay) expose no playback operations.

## Source names

Source tiles use German labels by default (set as each input's
`ConfiguredName`), mapped from the speaker's real `type` values:

| Devialet `type` | Label |
|---|---|
| `optical` | Optisch |
| `airplay2` | AirPlay |
| `bluetooth` | Bluetooth |
| `spotifyconnect` | Spotify Connect |
| `raat` | Roon |
| `upnp` | UPnP / DLNA |

Anything unmapped falls back to the raw `type` string. You can rename any input
directly in the Home app.

## How it works

- `DevialetClient` wraps the IP Control endpoints (`getSources`, `getCurrentSource`,
  `getVolume`, `setVolume`, `switchSource`, `play`, `pause`, plus an aggregated
  `getState`).
- Sources are enumerated **dynamically** at startup and addressed by their
  `sourceId` UUID (never by type name - the type is not a valid switch target).
- A polling loop reads source + volume + play state every `pollInterval` seconds
  and updates the HomeKit characteristics, so changes made in the Devialet app
  appear in Apple Home within one interval.
- Network errors are handled gracefully: an offline speaker marks the accessory
  inactive and the plugin keeps polling without crashing.

See [`api-discovery.md`](api-discovery.md) for the raw API responses this plugin
was built against.

## Development

```sh
npm run lint   # syntax-check all source files
npm test       # run DevialetClient tests against a mock server
```

## License

MIT

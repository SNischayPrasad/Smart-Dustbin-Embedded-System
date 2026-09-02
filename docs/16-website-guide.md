# 16. Website and Admin Dashboard

The `website/` folder is a complete front end for the system: a public status
page anyone can see, and a password-protected console for managing a fleet of
bins across a city.

It is **static** - plain HTML, CSS and JavaScript with no build step - so it
runs by double-clicking a file and deploys to GitHub Pages unchanged.

---

## Running it

**Simplest:** double-click `website/index.html`.

**Better, with a real backend:**

```bash
node server/server.js
```

Then open <http://localhost:3000>. No `npm install` - the server has zero
dependencies.

**Sign in**

| | |
|---|---|
| Username | `Nischay` |
| Password | `Admin@123` |

---

## The two pages

### Public site - `index.html`

Open to everybody, read only.

- Hero and explanation of how the system works
- Live city KPIs: bins deployed, normal, near full, needing collection, average fill
- An interactive map of all 16 bins, colour-coded by status
- A sortable table of every bin with fill bars and last-seen times
- Sections on industry relevance and the technology used

### Admin console - `admin.html`

Requires a login. `AUTH.requireAuth()` runs before anything renders, so an
unauthenticated visit is redirected to `login.html` immediately.

| Panel | What it does |
|---|---|
| **KPI row** | Fleet totals including offline devices |
| **City map** | Click any bin to select it; zone filter and fit-all |
| **Control panel** | Live readings for the selected bin plus remote commands |
| **Fleet actions** | Mute every full bin, plan a collection route, reset the demo |
| **Activity feed** | Timestamped log of every status change and command |
| **Fleet inventory** | Searchable, filterable table with a per-row Collect button |
| **Live firmware simulation** | The browser twin - sliders, animated bin, serial console |
| **Wokwi embed** | Paste your Wokwi project ID to embed the real simulator |
| **Live device** | Poll a real ESP32 over Wi-Fi and fold its readings into the map |

---

## Remote commands

Selecting a bin and pressing a button sends the same command set the firmware
accepts over serial:

| Button | Command | Effect |
|---|---|---|
| Open lid | `OPEN` | Forces the lid open, enters manual override |
| Close lid | `CLOSE` | Forces the lid shut, enters manual override |
| Auto mode | `AUTO` | Leaves override, resumes automatic control |
| Mute buzzer | `MUTE` | Silences the buzzer on that bin |
| Unmute | `UNMUTE` | Re-enables it |
| Ping device | `PING` | Marks an offline bin as reachable again |
| Mark as collected | `EMPTY` | Sets fill to 0 and resets the counters |

Commands to an offline bin are refused with an explanatory message rather than
silently appearing to work - which is what a real operations console must do.

---

## The collection route planner

**Fleet actions > Plan collection route** takes every bin that is online and
above 75 %, starts at the fullest, and repeatedly drives to the nearest bin
still on the list. That is the classic greedy nearest-neighbour heuristic for
the travelling salesman problem: not optimal, but fast, easy to explain, and
much better than visiting bins in arbitrary order.

It reports the stop count and an approximate distance, converting degrees to
kilometres with the usual 111 km per degree of latitude.

---

## The firmware twin

`assets/js/sim.js` is a JavaScript port of the state machine in
`04_smart_dustbin_complete.ino` - the same thresholds, the same four lid
states, the same fusion rule, even the same 1 Hz level-sampling rate so the
counters advance at the same speed.

Three sliders correspond to the three sensors. The scenario buttons are the
quickest way to demonstrate the design:

| Button | Shows |
|---|---|
| **Uneven pile (A 90 / B 10)** | Fused 50 %, `UNEVEN LOAD` raised, sloped waste surface |
| **Unplug sensor A** | `sensors 1 / 2`, degraded mode still reporting |
| **Reset sensors** | Back to an empty, even bin |

`node tests/twin.test.js` asserts that this twin behaves identically to the
firmware, with 64 checks.

> If you change a threshold in the `.ino`, change it in `sim.js` too. The
> tests exist to catch you when you forget.

---

## Connecting a real ESP32

1. Flash `arduino_code/05_esp32_wifi_version` to an ESP32 on your Wi-Fi.
2. It prints its IP address on the serial monitor at 115200 baud.
3. Paste that address into **Live device** and press Connect.

The dashboard then polls `http://<ip>/api/status` every three seconds and
folds the real readings into the map. The line that makes this possible is in
the sketch:

```c
server.sendHeader("Access-Control-Allow-Origin", "*");
```

Without that CORS header the browser fetches the data and then refuses to let
the page read it - which looks exactly like a network failure and is not.

---

## Where the data lives

By default the fleet lives in the browser's `localStorage`, so commands
survive a reload and the demo works from a `file://` URL with no setup. Press
**Reset demo data** to restore the seed fleet from `data/bins.json`.

Run `server/server.js` instead and the same dashboard is served by a real
backend with server-side sessions and authenticated REST endpoints.

---

## A note on the login

**The login on `login.html` is a client-side demo.** The credentials are in
JavaScript the browser downloads, so anyone can read them in DevTools. That is
fine for a college project and is **not** fine for anything real. The top of
`assets/js/auth.js` says so explicitly and lists what a production version
would do instead.

`server/server.js` demonstrates the real approach: passwords compared against
a salted hash using a constant-time comparison, a random session token in an
`HttpOnly; SameSite=Strict` cookie that page JavaScript cannot read, and every
`/api/*` route re-checking that cookie server-side.

Being able to explain *why* the simple version is insufficient is worth more
in a viva than having quietly used it and hoped nobody asked.

---

## Mobile

The site is responsive down to 320 px. Three things change on a phone, and
each solves a problem that was measured rather than guessed at:

**1. The nav scrolls instead of wrapping.** With five links plus a sign-in
button, the row wrapped and spilled out of the fixed 48 px header, overlapping
the page beneath it. On phones the nav becomes a horizontally scrollable strip
with a fade on the right edge, and the header keeps its height.

**2. Every control is at least 40 px tall.** Buttons were 27-30 px and the
range sliders had a 4 px hit area, which is unusable with a finger. Buttons
now have a `min-height`, and the sliders get vertical padding that grows the
touch target without changing how the track looks.

**3. Tables drop columns rather than scrolling sideways.** The fleet table has
ten columns and forced a 640 px minimum width. On a phone it shows Bin,
Location, Fill and Status; the rest are hidden with `display: none` on both
the header and the body cells - hiding only the body leaves a wider header row
that drags the table back out. Because the per-row Collect button is hidden,
tapping a row scrolls the control panel into view instead.

Other adjustments: the map drops from 480 px to 300 px, KPI cards go to two
columns (one below 360 px), the hero left-aligns with full-width buttons, the
dustbin illustration is capped at 200 px, and hover styles are suppressed on
touch devices so states do not stick after a tap.

Breakpoints: **820 px** (tablet), **640 px** (phone), **360 px** (small
phone), plus a landscape rule that shortens the map when the viewport is under
520 px tall. Every mobile rule lives inside a `max-width` query, so the
desktop layout is untouched.

---

## Theme

The visual language follows apple.com: a near-white canvas with `#f5f5f7`
section bands, a single accent blue (`#0071e3`), SF-style system fonts with
tight tracking on the large headlines, pill-shaped buttons and soft 18 px
cards. Full dark mode is included via `prefers-color-scheme`, so the site
follows the operating system setting.

Everything is driven by CSS custom properties at the top of
`assets/css/style.css` - change `--brand` and the whole site re-themes.

---

## File map

```
website/
├── index.html              Public status page
├── login.html              Admin sign-in
├── admin.html              Fleet dashboard
└── assets/
    ├── css/style.css       Theme tokens, layout, components
    ├── img/circuit.svg     Wiring diagram
    └── js/
        ├── data.js         Fleet model, commands, simulated telemetry
        ├── auth.js         Login, session, route guard
        ├── map.js          Leaflet map with an offline fallback
        ├── sim.js          Firmware twin + animated dustbin SVG
        ├── public.js       Public page behaviour
        └── admin.js        Dashboard behaviour
```

The map uses Leaflet from a CDN. With no internet it falls back automatically
to a simple projected grid map, so bin selection still works offline - useful
when the exam hall Wi-Fi does not.

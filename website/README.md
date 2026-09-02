# Smart Dustbin - Website and Admin Dashboard

A public status page and a password-protected fleet console for the Smart
Dustbin embedded system.

Static HTML, CSS and JavaScript. No build step, no framework, no npm install.

---

## Run it

**Simplest** - double-click `index.html`.

**With a real backend:**

```bash
node ../server/server.js
```

Then open <http://localhost:3000>.

**Sign in**

| | |
|---|---|
| Username | `Nischay` |
| Password | `Admin@123` |

---

## Pages

| File | Purpose |
|---|---|
| `index.html` | Public city status - map, KPIs, bin table, how it works |
| `login.html` | Admin sign-in with attempt lockout |
| `admin.html` | Fleet dashboard - map, remote control, simulator, live device |

---

## What the dashboard can do

- Click any bin on the map or in the table to select it
- Send `OPEN`, `CLOSE`, `AUTO`, `MUTE`, `UNMUTE`, `PING`, `EMPTY`
- Filter by zone or status, search by name
- Mute every full bin at once
- Plan a collection route (greedy nearest-neighbour over the bins above 75 %)
- Watch a live activity log of every status change and command
- Drive a **firmware twin** - the same state machine as the Arduino sketch,
  running in the browser, with three sensor sliders and a serial console
- Embed your own Wokwi project
- Poll a real ESP32 over Wi-Fi and fold its readings into the map

---

## Files

```
website/
├── index.html
├── login.html
├── admin.html
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

Modelled on apple.com: near-white canvas with `#f5f5f7` section bands, a
single accent blue (`#0071e3`), SF-style system fonts with tight tracking on
large headlines, pill buttons, soft 18 px cards, and full dark mode via
`prefers-color-scheme`.

Everything is driven by CSS custom properties at the top of
`assets/css/style.css`. Change `--brand` and the whole site re-themes.

---

## Offline behaviour

The map uses Leaflet from a CDN. With no internet it falls back automatically
to a projected grid map, so bin selection still works - useful when the exam
hall Wi-Fi does not.

Fleet state lives in `localStorage`, so commands survive a reload and the demo
runs from a `file://` URL. **Reset demo data** restores the seed fleet.

---

## Security notice

**The login here is a client-side demo.** The credentials are in JavaScript
the browser downloads, so anyone can read them in DevTools. That is acceptable
for a college project and is **not** acceptable for anything real. The top of
`assets/js/auth.js` explains this and lists what a production version would do.

`../server/server.js` demonstrates the correct approach: salted-hash password
comparison in constant time, a random session token in an
`HttpOnly; SameSite=Strict` cookie, and every `/api/*` route re-checking that
cookie server-side.

---

## Deploying to GitHub Pages

1. Repo **Settings > Pages**
2. Source: **Deploy from a branch**, branch `main`, folder `/ (root)`
3. Open `https://<username>.github.io/Smart-Dustbin-Embedded-System/website/`

Everything works on Pages. The Node server is optional and not used there.

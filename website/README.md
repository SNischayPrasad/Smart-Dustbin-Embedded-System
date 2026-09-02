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

## Sign in with Google (OAuth 2.0 / OpenID Connect)

The site supports real Google sign-in alongside the demo login. It is **off
until you add a Client ID**, and nothing breaks while it is off.

### Turning it on

Edit one line in `website/assets/js/auth-config.js`:

```js
GOOGLE_CLIENT_ID: "1234567890-abcdef.apps.googleusercontent.com",
```

To get that ID: Google Cloud Console → new project → **OAuth consent screen**
(External, Testing is fine) → **Credentials → OAuth client ID → Web
application** → add these authorised JavaScript origins:

```
https://snischayprasad.github.io
http://localhost:3000
```

### Who may sign in — the user registry

`website/assets/js/users.js` holds the registry: who exists, and what each
person may do.

| Signed in as | Role | Can control bins |
|---|---|---|
| **nischayprasuna@gmail.com** (Google) | Administrator | **Yes** |
| Demo credentials on the login page | Viewer | No |
| Any other Google account | *refused* | — |

Only one account has administrator access. Everyone else is either read-only
or turned away, and `DEFAULT_ROLE_FOR_UNKNOWN: "deny"` is what makes an
unrecognised Google account a refusal rather than a guest pass.

**The demo login is deliberately read-only.** Its credentials are printed on
the page and in this README, so anyone can use them — which means they must
not command anything. A demo visitor sees the whole fleet, the map and the
simulator, and every control is visibly disabled with an explanation. That
keeps the public demo useful without handing out the keys.

### The address is stored as a hash

This repository is public, so committing a personal Gmail address in plain
text hands it to every scraper that walks GitHub. The registry stores the
SHA-256 of the lowercased address instead — sign in, hash what Google
returns, compare:

```js
{ emailHash: "007dda63…", name: "Nischay", role: "admin" }
```

Be precise about what that achieves: it is **not** encryption and **not** a
security control. Anyone who guesses the address can hash it and confirm the
match. It defeats bulk harvesting, which is the realistic risk, and nothing
more.

Plain text works too if you prefer it readable:

```js
{ email: "you@gmail.com", name: "You", role: "admin" }
```

Generate a hash for any address with:

```bash
node tools/hash-email.js someone@example.com
```

### Adding people

```js
USERS: [
  { emailHash: "007dda63…",          name: "Nischay",  role: "admin"  },
  { email: "teammate@gmail.com",     name: "Teammate", role: "viewer" }
]
```

Roles are defined at the top of the same file, so adding a third — an
`operator` who may collect bins but not reset the demo, say — is a few lines.

### Tested

```bash
node tests/users.test.js
```

30 assertions: the owner resolves to `admin` and is the only one; the address
matches case-insensitively and with stray whitespace; near-miss addresses
(`…@googlemail.com`, `…+admin@gmail.com`, a one-letter typo) are all refused;
the plain address does **not** appear in the file; the demo login cannot
control, bulk-act or reset; and an unknown role falls back to viewer rather
than failing open.

### Turning it on with one command

Once you have a Client ID from Google:

```bash
node tools/set-client-id.js 1234567890-abcdef.apps.googleusercontent.com
```

It validates the format, writes `auth-config.js`, and prints the commands to
publish. Run it with no argument to see whether sign-in is currently on.

It also refuses to write anything that looks like a client **secret**, since
a secret committed to a public repository is public forever.

### Why this flow, on a static host

The classic Authorization Code flow exchanges a code for a token using a
**client secret**. A secret cannot live in front-end code, so that flow needs
a server — and GitHub Pages has none.

Google Identity Services solves this for **public clients**: Google
authenticates the user itself and hands the page a signed **ID token**. No
secret is involved, because possession of the token is not what proves
anything — the **signature** is.

> The Client ID is **not** a secret. It is a public identifier meant to ship
> in front-end code. The *client secret* on the same Google page is never used
> by this project and must never be committed.

### The part most tutorials skip

Many examples decode the JWT with `atob()` and trust the payload. **That is
not authentication.** A JWT is three base64url strings; anyone can craft one
claiming to be anybody. The payload only means something once the signature
has been verified.

`website/assets/js/oauth.js` does the real thing:

1. Fetch Google's **JWKS** (its published public signing keys)
2. Select the key whose `kid` matches the token header
3. Verify the **RS256 signature** with WebCrypto
4. Validate `iss`, `aud`, `exp`, `nbf` and `email_verified`

It also refuses any token whose header is not `RS256` — an `alg: "none"`
token is the textbook JWT forgery and is rejected before any other work.

### It is tested against forgeries

```bash
node tests/oauth.test.js
```

27 assertions. A local RSA key pair stands in for Google's, and most cases are
attempts to get a **bad** token accepted: signed with the wrong key, payload
swapped after signing, `alg: none` and `HS256` downgrades, unknown key id,
wrong `aud`, wrong issuer, expired, `nbf` in the future, unverified email.
Every one is rejected with a specific reason.

### Honest limits — say this in a viva

Verifying in the browser proves the token really is Google's. It does **not**
make this dashboard secure, because there is no server and no protected API:
the fleet lives in `localStorage`, so anyone can edit it from DevTools no
matter who signed in.

Real authorisation requires the **server** to verify the token on every
request — which is what `server/server.js` demonstrates. What this adds is
genuine authentication in front of a client-side app, and being able to
explain that distinction is worth more than the feature itself.

### Graceful degradation

| Situation | Behaviour |
|---|---|
| No Client ID configured | Google block hidden; demo sign-in only |
| Configured but Google unreachable | "Could not reach Google. Use the demo sign-in below." |
| Configured and online | Real Google button; demo login still available below it |

That last row matters for a viva on a bad network — the project never depends
on Google being reachable.

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

**The login here is a client-side demo**, and the page says so above the
fields. The credentials are in JavaScript
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

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

**The login on `login.html` is a client-side demo**, and the page says so
above the fields. The credentials are in
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

### The simulator runs on the public page too

The firmware twin is on both `index.html` and `admin.html`. The wiring lives
in one place - `assets/js/simulator.js` - and each page just calls:

```js
initSimulator("[data-simulator]", { deviceId: "BIN-DEMO" });
```

Controls are found by `data-sim` attributes scoped to that root, and every one
of them is optional, so a page can include a cut-down panel without the module
complaining. This replaced 178 lines that had been sitting inside `admin.js`;
having the panel in two places would have guaranteed the two drifted apart.

### Who may sign in — the user registry

`website/assets/js/users.js` holds the registry: who exists, and what each
person may do.

| Signed in as | Role | Can control bins | Can manage users |
|---|---|---|---|
| The project owner (Google) | Owner | **Yes** | **Yes** |
| Five teammate accounts (Google) | Administrator | **Yes** | No |
| Demo credentials on the login page | Viewer | No | No |
| Any other Google account | *refused* | — | — |

Six named accounts have administrator access, one of them the owner. Everyone else is either
read-only or turned away, and `DEFAULT_ROLE_FOR_UNKNOWN: "deny"` is what
makes an unrecognised Google account a refusal rather than a guest pass.

The addresses themselves are not written down anywhere in this repository -
see below.

**The demo login is deliberately read-only.** Its credentials are printed on
the page and in this README, so anyone can use them — which means they must
not command anything. A demo visitor sees the whole fleet, the map and the
simulator, and every control is visibly disabled with an explanation. That
keeps the public demo useful without handing out the keys.

### Roles: owner, administrator, viewer

| Role | Fleet control | Manage users |
|---|---|---|
| **Owner** | yes | **yes** |
| Administrator | yes | no |
| Viewer (the demo login) | no | no |

One owner, five administrators. Administrators can command every bin in the
city but cannot grant access to anybody &mdash; separating *can operate the
system* from *can decide who operates it* is the whole reason a role sits
above administrator.

### The user management console

`users.html` is owner-only. It is linked from the dashboard nav, but only for
a session that may actually use it &mdash; and the page guards itself as
well, because hiding a link is presentation, not access control. An
administrator who types the URL is redirected back to the dashboard and told
why.

It lets the owner:

- see the registry &mdash; names, roles and the first characters of each
  address digest
- add someone by email, hashed in the browser with WebCrypto so the plain
  text never enters the registry
- remove someone, except the last remaining owner
- copy or download the exact `USERS` array to commit

**The registry cannot show addresses back to you.** They are stored as
digests, and a digest does not reverse. That is the point of the hashing, and
it is why people are identified here by name and digest prefix.

### Why there is a second step

The site is static. There is no database and no API to POST to, so a change
made in this page takes effect **in that browser only** until the generated
`users.js` is committed and pushed.

The working copy is deliberately **not** persisted to `localStorage`. Writing
roles there would let anyone grant themselves ownership from DevTools and
have it stick, which would turn a documented limitation into a real back
door. Reload the page and you are back to the committed registry; the file in
the repository stays the single source of truth.

In a real deployment this form would POST to an API and the server would own
the table. The generated-file step is exactly where that server would go, and
saying so is a better answer in a viva than pretending the gap is not there.

### Making changes stick: the Firestore store

Out of the box the admin list is the one committed in `users.js`, and the
management console generates a file for you to commit. Fill in
`assets/js/firebase-config.js` and the list moves to Firestore instead:
changes are instant, shared by everyone, and survive without touching the
repository.

**This is also the point where the project stops hand-waving about security.**
Every other check in the site runs in the browser, so it decides what the
interface offers rather than what a determined person can do. Firestore
Security Rules run on Google's servers. With `firestore.rules` published, an
attacker editing `localStorage`, forging a session or calling the REST API by
hand still cannot add an administrator, because the write is refused before
it reaches the database:

```
allow create, update: if isOwner() && validEntry(request.resource.data);
allow delete:         if isOwner();
```

`isOwner()` compares `request.auth.uid` against a single hard-coded UID. A
UID is used rather than an email because this file is public and a UID
reveals nothing about who the person is.

#### Setup

Full click-path is in `assets/js/firebase-config.js`. In short:

1. Firebase console → new project
2. Authentication → Sign-in method → enable **Google**
2b. Authentication → **Settings → Authorised domains** → add
   `snischayprasad.github.io` (localhost is there already). Miss this and
   sign-in fails on the live site with an error that names the domain rather
   than the setting.
3. Firestore Database → Create, in **production** mode
4. Project settings → Web app → copy the config into `firebase-config.js`
5. Sign in once, then copy your UID from Authentication → Users into
   `OWNER_UID` — the management console displays it for you
6. Firestore → Rules → paste `firestore.rules`, replacing `OWNER_UID_HERE`

Step 6 is the one that matters. Without it the database is open.

#### The committed registry is always the floor

`users.js` is loaded first and cloud entries are merged on top. That is
deliberate: if Firebase is unreachable, misconfigured or the free tier runs
out, the owner can still sign in from the file in the repository. A remote
dependency should never be able to lock you out of your own project. The
console says which backend it is on, and warns when it has fallen back.

#### Tested

```bash
node tests/store.test.js
```

35 assertions against a stubbed Firestore: the merge (cloud overriding a
committed role, case-insensitive hash matching, cloud-only additions), that
only digests are ever written, that a write refused by Security Rules raises
rather than silently succeeding, and that an outage mid-session leaves the
owner able to sign in from the committed registry.

### Addresses are stored as hashes

This repository is public, so committing personal email addresses in plain
text hands them to every scraper that walks GitHub. That matters more for
teammates than for yourself: publishing someone else's address is not your
decision to make. The registry stores the SHA-256 of the lowercased address
instead — sign in, hash what Google returns, compare:

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

37 assertions — and the suite itself contains **no real address**. A test
that hard-coded the addresses in order to check their hashes would hand them
straight back to the scrapers the hashing was meant to defeat. So the real
registry is checked only through properties that reveal nothing (six admins,
every entry a distinct 64-character digest, unknown addresses refused), and
the matching logic is exercised against synthetic `@example.com` addresses
injected into a throwaway registry.

It also asserts that neither the registry nor the test file contains a
personal-address literal — with the search string assembled at runtime, since
a literal would match its own source.

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

### Cache-busting after a push

GitHub Pages serves assets with a cache lifetime, so after a push a browser
will happily keep running yesterday's JavaScript - which looks exactly like
the fix not working. Before committing front-end changes, run:

```bash
node tools/bump-assets.js
```

It stamps `?v=<commit count>` onto every same-origin CSS and JS reference in
the HTML pages, so the URL changes whenever the code does and the browser is
obliged to refetch. CDN URLs are left alone - they are already versioned in
the path and are meant to be cached hard.

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

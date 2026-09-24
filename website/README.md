# Smart Dustbin - Website, Admin Dashboard and Crew Page

A public status page, a password-protected fleet console, and a page for the
collection crew, for the Smart Dustbin embedded system.

Static HTML, CSS and JavaScript. No build step, no framework, no npm install.
The shared data lives in Firestore, which the pages talk to directly.

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

That demo session is read-only, and it is a *viewer*, so `collector.html`
shows it the crew sign-in card rather than the route. The crew page wants the
shared crew password - see "Setup" below for creating that account - or an
owner or administrator session, which walks straight in.

---

## Pages

| File | Purpose |
|---|---|
| `index.html` | Public city status - map, KPIs, bin table, how it works |
| `login.html` | Admin sign-in with attempt lockout |
| `admin.html` | Fleet dashboard - map, remote control, simulator, live device |
| `collector.html` | The collection crew's route, on a phone |
| `users.html` | Owner-only: the admin registry and the cloud setup check |

---

## What the dashboard can do

- Click any bin on the map or in the table to select it
- Send `OPEN`, `CLOSE`, `AUTO`, `MUTE`, `UNMUTE`, `PING`, `EMPTY`
- Filter by zone or status, search by name
- Mute every full bin at once
- Plan a collection route (nearest neighbour, then 2-opt)
- Watch a live activity log of every status change and command, shared with
  everyone else who is signed in
- Drive a **firmware twin** - the same state machine as the Arduino sketch,
  running in the browser, with three sensor sliders and a serial console
- Embed your own Wokwi project
- See a real ESP32's readings as they arrive through Firestore, and command it
  back the same way

---

## What the crew page can do

`collector.html` is deliberately narrow. The crew get the route and nothing
else - no bulk commands, no muting, no resetting, no user management - and the
Firestore rules refuse those anyway, so the page is not the only thing
stopping it.

- Sign in with one shared crew password and your own name, which is what the
  activity log records ("Crew - Ravi")
- Plan the round: due now, near full, stops, estimated km and minutes, litres
  against the truck's capacity
- A map with numbered stops and the route drawn between them
- Per stop: **Open lid (crew override)** and **Mark collected**
- **Open in Google Maps** per leg, which hands the ordered stops to turn-by-turn
  navigation

Marking a bin collected writes back to the shared fleet, so the city dashboard
and every other crew phone drop it from the list within a second.

---

## Files

```
website/
├── index.html
├── login.html
├── admin.html
├── collector.html
├── users.html
└── assets/
    ├── css/style.css       Theme tokens, layout, components
    ├── img/circuit.svg     Wiring diagram
    └── js/
        ├── data.js         Fleet model: the clock-based fill, commands, log
        ├── fleet-cloud.js  The Firestore subscription and the writes
        ├── firebase-config.js  Project keys, owner/crew/device allow-lists
        ├── users.js        The registry: who exists, and what each role may do
        ├── auth.js         Login, session, route guard
        ├── oauth.js        Google ID token verification (WebCrypto)
        ├── oauth-ui.js     Google Sign-In button wiring
        ├── user-store.js   The admin registry in Firestore
        ├── user-admin.js   users.html behaviour, sync and setup check
        ├── map.js          Leaflet map with an offline fallback
        ├── sim.js          Firmware twin + animated dustbin SVG
        ├── simulator.js    The simulator panel, shared by both pages
        ├── route.js        Nearest neighbour + 2-opt + Google Maps links
        ├── collector.js    Crew page behaviour
        ├── public.js       Public page behaviour
        └── admin.js        Dashboard behaviour
```

---

## The fleet model: the clock, not a random walk

The site shows **48 bins** in 36 zones, two of them offline on purpose
(`BIN-012` and `BIN-038`). Only one of them can ever be a real board, so the
rest are simulated - and the way they are simulated is the part worth
explaining.

Each bin's fill is a **pure function of the time of day**. The zone sets a
rate (a railway station fills at 40 % an hour, a park at 10), a hash of the
bin id scales it by 0.8 to 1.2 so no two bins move in step, and a bin that
reaches 100 % is emptied by a simulated crew an hour later and starts again.

```js
SD.modelBin(seed, overlay, now)   // pure: same inputs, same bin record
```

Because it is a function of the clock, a laptop and a phone open at the same
moment compute identical numbers with **no database writes at all**. The
previous version random-walked a private fleet into each browser's
`localStorage`, so two screens side by side disagreed - and once the data was
shared, every open tab would have been writing its own random numbers into
Firestore.

So the database stores only what a clock cannot know: what people and devices
actually did.

---

## Live cloud data

`fleet-cloud.js` subscribes to `bins` in Firestore with one `onSnapshot` and
pushes each document into the fleet model as an **overlay**: when the bin was
last collected and by which role, any manual lid override, whether it is
muted, and the latest reading from a real board. The overlay wins over the
model. A second collection, `events`, carries the shared activity log - and it
is the only place a display name appears, because `bins` is world-readable.

Every page shows a status pill saying which it is on:

| Pill | Meaning |
|---|---|
| **Live cloud** | Connected; what you do is shared |
| **Connecting...** | The first snapshot has not arrived yet |
| **Local demo** | No Firebase config; this browser only |
| **Cloud error** | Usually "the rules are not published yet" - the pill says which |

The crew page words the same four states for somebody standing next to a
truck: **Live - shared with the city dashboard**, **Local demo - not shared**.

Nothing here writes on a timer. Reads are a subscription, writes happen only
when somebody presses a button, and the free tier is never in danger.

**This is also how a real board reaches the dashboard.** The ESP32 used to be
reachable only by polling `http://<its ip>/api/status`, which meant the laptop
had to be on the same Wi-Fi as the bin - and on the live HTTPS site the
browser blocked the request as mixed content before it ever left the page. Now
the board signs in to Firebase itself and writes into its own bin document
over TLS. The direct-IP panel is still on the dashboard, folded away, for
bench work from a local `http://` page.

---

## Planning the route

`route.js` is pure - no DOM, no clock, no randomness - so every number the
crew see on their phone can be checked under Node. It is two stages.

**Nearest neighbour** builds a first route: from the start, always drive to
the closest bin not yet visited. It is fast and obvious, and it has a known
weakness - it paints itself into corners and leaves long jumps at the end,
which show up on the map as lines crossing each other.

**2-opt** then repairs that. Take every pair of legs `A->B ... C->D`; if
turning them into `A->C ... B->D` (reversing the stretch between) is shorter,
do it, and repeat until nothing helps. A route that crosses itself can
*always* be shortened this way, so 2-opt removes every crossing.

The exact best order is the Travelling Salesman Problem - twenty bins already
have 20! orders, about 2.4 x 10^18 - so a heuristic within a few percent is
what real fleet software uses too.

Distances are straight lines on the globe (haversine), scaled by **1.35** for
city roads, and the time estimate is **22 km/h plus four minutes a stop**.
These are estimates and the page says so.

### Handing the route to Google Maps

Each leg becomes a `https://www.google.com/maps/dir/?api=1` link. No API key,
nothing to bill, and it opens the Google Maps app if the phone has one.

Three facts from Google's documentation shape the code:

- **Nine waypoints per link on a computer or in the Maps app, three in a
  mobile browser.** So the route is split into legs, and "Stops per link" is a
  setting with those two values.
- **Omitting the origin means "start from where I am".** That is the default
  here, plus `dir_action=navigate`, so a driver gets turn-by-turn from the cab
  rather than a preview from the depot. A dispatcher planning on a computer
  can switch the origin back on.
- **Google does not reorder waypoints.** It drives them in the order given -
  which is precisely why the ordering has to be done here first.

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
| Two project owners (Google) | Owner | **Yes** | **Yes** |
| Four teammate accounts (Google) | Administrator | **Yes** | No |
| The shared crew password on `collector.html` | Collector | Only on the route | No |
| Demo credentials on the login page | Viewer | No | No |
| Any other Google account | *refused* | — | — |

Six named accounts have administrator access, two of them owners. Everyone else is either
read-only or turned away, and `DEFAULT_ROLE_FOR_UNKNOWN: "deny"` is what
makes an unrecognised Google account a refusal rather than a guest pass.

The crew are not in the registry, because they are not individuals: they are
one shared account that a shift signs in to, typing their own name for the
activity log. The role comes from the account, not from a row in a file.

The addresses themselves are not written down anywhere in this repository -
see below.

**The demo login is deliberately read-only.** Its credentials are printed on
the page and in this README, so anyone can use them — which means they must
not command anything. A demo visitor sees the whole fleet, the map and the
simulator, and every control is visibly disabled with an explanation. That
keeps the public demo useful without handing out the keys.

### Roles: owner, administrator, collector, viewer

| Role | Fleet control | Bulk commands | Crew page | Manage users |
|---|---|---|---|---|
| **Owner** | yes | yes | yes | **yes** |
| Administrator | yes | yes | yes | no |
| Collector (the crew) | only the lid of a bin on the route | no | yes | no |
| Viewer (the demo login) | no | no | no | no |

Two owners, four administrators. Administrators can command every bin in the
city but cannot grant access to anybody &mdash; separating *can operate the
system* from *can decide who operates it* is the whole reason a role sits
above administrator.

A collector sits below both. They can do exactly two things to a bin, and only
to a bin on their route: force the lid of a full one open so they can empty
it, and mark it collected. They cannot mute a buzzer, cannot PING a dead
device, cannot run a fleet-wide command and cannot reset anything. **That is
enforced twice** - the page does not offer it, and `firestore.rules` refuses
the write if somebody asks for it by hand. The second one is the one that
counts.

An administrator or owner who opens `collector.html` is let straight in,
because somebody has to be able to check what the crew are seeing.
`admin.html` does the reverse and sends a crew session to `collector.html`,
since the fleet console is not their page.

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

`isOwner()` checks `request.auth.uid` against a hard-coded list of UIDs. A
UID is used rather than an email because this file is public and a UID
reveals nothing about who the person is.

**Adding an owner takes two edits, not one.** The registry role in `users.js`
decides what the *page* offers; the UID list in `firestore.rules` decides
what the *database* permits. Change only the first and the new owner gets the
management screen but every write is refused - which looks like a bug rather
than a missing step. A person also has no UID until their first Firebase
sign-in, so this cannot be done in advance.

#### What the rules actually enforce

`firestore.rules` is no longer only about the admin list. It decides every
write the site can make:

| Who | Recognised by | May write |
|---|---|---|
| **Owner** | UID in `ownerUids()`, verified address | every staff field on any bin, plus the admin registry |
| **Administrator** | verified address whose SHA-256 has a registry document saying `owner`/`admin` | every staff field on any bin |
| **Collector** | UID in `collectorUids()` | `collectedAt` with `collectedByRole: "crew"`, and a lid override. Not mute, not PING, and it cannot claim to be an administrator |
| **Device** | UID is a key of `deviceBins()`, mapped to one bin | the `device` readings and `commandAck` of **its own bin only** |
| Anybody else | — | nothing. Being signed in, including anonymously, earns nothing |

Two details worth knowing. **No write may backdate itself**: wherever a
timestamp is set - a collection, a device report, a command - it has to equal
`request.time`, so a client cannot claim a bin was emptied an hour ago. And
**`bins` is world-readable**, which is why no name, address or UID goes into
it; the activity log is a separate collection that only staff and crew can
read.

#### Setup

The code is finished; the Firebase project is not. **Until step 1 is done
every page falls back to its own local simulation** - which is exactly what
the live site does today. Nothing is broken and nothing is shared, and each
page says so on its status pill.

All of this is in the Firebase console for project `sdbs-399da`. The full
click-path with screenshots-worth of detail is in
`assets/js/firebase-config.js`.

1. **Publish the rules.** Firestore Database > Rules, paste `firestore.rules`
   from the repository root, press **Publish**. This is the step that makes
   the fleet live.
2. **Authorised domains.** Authentication > Settings > Authorised domains >
   add `snischayprasad.github.io`. Without it, sign-in fails on the live site
   with an error that names the domain rather than the setting.
3. **Enable Email/Password.** Authentication > Sign-in method >
   Email/Password > Enable. This is how the crew and the boards sign in;
   Google sign-in stays as it is for owners and administrators.
4. **Create the crew account.** Authentication > Users > Add user, address
   `crew@sdbs-399da.firebaseapp.com`, password of your choosing - tell the
   crew, write it down nowhere in this repository. Copy the new UID into
   **both** `COLLECTOR_UIDS` in `assets/js/firebase-config.js` and
   `collectorUids()` in `firestore.rules`, **publish the rules again**, then
   confirm the two files agree:

   ```bash
   node tools/check-owners.js
   ```

5. **Optional - a real board.** Only needed for a physical ESP32 or a Wokwi
   project. Add a second user for the device, copy
   `arduino_code/05_esp32_wifi_version/secrets.example.h` to `secrets.h` and
   fill it in, then put `{ "<device uid>": "BIN-001" }` into `DEVICE_BINS` and
   into `deviceBins()`, and publish again.
6. **Finish on `users.html`.** Signed in as an owner, press **Sync registry to
   cloud** so the database recognises every administrator committed in
   `users.js`, then press **Run check** and work down any line that says TODO.

Steps 1 and 4 are the ones that are easy to half-do. An empty allow-list
allows nobody, which is correct - so a crew page that signs in happily and
then has every write refused means step 4 was done in one file and not the
other. `node tools/check-owners.js` is there to say which.

#### Keeping the two owner lists in step

An owner is defined in two places and both must agree: `OWNER_UIDS` in
`firebase-config.js` decides what the page offers, and `ownerUids()` in
`firestore.rules` decides what the database permits. Nothing enforces the
match automatically, so:

```bash
node tools/check-owners.js
```

If they drift, the new owner gets the management screen and is then refused
on every write - which reads as a bug rather than a missing edit.

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

44 assertions against a stubbed Firestore: the merge (cloud overriding a
committed role, case-insensitive hash matching, cloud-only additions), that
only digests are ever written, that a write refused by Security Rules raises
rather than silently succeeding, and that an outage mid-session leaves the
owner able to sign in from the committed registry.

The rules themselves are tested separately, against the real Firebase
emulator - see "Testing" at the end of this file.

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

62 assertions — and the suite itself contains **no real address**. A test
that hard-coded the addresses in order to check their hashes would hand them
straight back to the scrapers the hashing was meant to defeat. So the real
registry is checked only through properties that reveal nothing (six admins,
every entry a distinct 64-character digest, unknown addresses refused), and
the matching logic is exercised against synthetic `@example.com` addresses
injected into a throwaway registry.

It also pins down what a collector may not do - no bin control, no bulk
commands, no resetting, no user management - and that nobody in the registry
holds that role, because the crew arrive through the shared account instead.

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

24 assertions. A local RSA key pair stands in for Google's, and most cases are
attempts to get a **bad** token accepted: signed with the wrong key, payload
swapped after signing, `alg: none` and `HS256` downgrades, unknown key id,
wrong `aud`, wrong issuer, expired, `nbf` in the future, unverified email.
Every one is rejected with a specific reason.

### Honest limits — say this in a viva

Verifying in the browser proves the token really is Google's. On its own that
is **authentication**, not authorisation: it establishes who is asking, and
nothing about what they are allowed to do.

The authorisation is `firestore.rules`, and it is real. Google's servers, not
this page, decide whether a write lands. Forge a session in `localStorage`,
call the REST API by hand, edit the buttons back into existence — a
collection, a lid override or a device reading still gets refused before it
reaches the database.

What the rules do not cover is the part that never reaches the database. The
simulated fill curve is computed in each browser from the clock, so somebody
can still make their own copy of the page display whatever they like; it just
does not travel to anybody else. And the demo login on `login.html` is exactly
what it says on the page — credentials in downloadable JavaScript, which is
why that session is read-only.

Being able to draw those two lines — what is checked on a server, what is
only presentation — is worth more in a viva than any single feature here.

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

Fill levels are computed from the clock, so they are right with no network at
all. What needs the cloud is what people did - and with no cloud those changes
are kept in `localStorage` instead, so commands still survive a reload and the
demo still runs from a `file://` URL. The status pill says **Local demo** so
nobody thinks a collection was shared when it was not. **Reset demo data**
clears this browser's copy; it does not touch the cloud.

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

## Testing

Everything that is not the DOM is tested under plain Node, with no framework
to install:

```bash
node tools/run-tests.js
```

```
  PASS  cloud      103 passed
  PASS  fleet      105 passed
  PASS  oauth       24 passed
  PASS  route       58 passed
  PASS  store       44 passed
  PASS  twin        88 passed
  PASS  users       62 passed
  --------------------------------------
  486 checks passed, 0 failed, in 7 suites
```

| Suite | What it holds down |
|---|---|
| `twin` | The firmware twin, including the full-bin lockdown and its two exceptions |
| `fleet` | The clock-based fill model, the overlay, the command set, the summary |
| `cloud` | `fleet-cloud.js` against a stubbed Firestore: snapshots in, commands out |
| `route` | Haversine, that 2-opt only ever improves a route, and the Maps URL format |
| `users` | Who may do what, with no real address anywhere in the file |
| `store` | The admin registry in Firestore, including an outage mid-session |
| `oauth` | 24 attempts to get a forged Google token accepted, all refused |

Each suite also runs on its own - `node tests/twin.test.js` - which is what
you want while you are working on one.

### The Security Rules have their own suite

`firestore.rules` is the only access control an attacker cannot edit, so it is
tested against the real Firebase emulator rather than a stub:

```bash
cd tests/rules
npm install          # once
npm test
```

```
  99 passed, 0 failed
```

It needs **Java** (the emulator is a JAR) and it is not run by
`tools/run-tests.js` for that reason. Nothing is sent to Google and no login
is needed - the project id is `demo-sdbs`, and the `demo-` prefix keeps the
emulator entirely local.

The suite runs three passes over the same file: the rules exactly as
committed; the same file with test UIDs substituted into the crew and device
allow-lists, so those paths can be exercised before the real accounts exist;
and a third pass that loads `fleet-cloud.js` for real and sends every command
the dashboard can issue through the live rules. That last pass catches the
failure the other two cannot - both halves individually correct and
disagreeing with each other. Details in `tests/rules/README.md`.

---

## Deploying to GitHub Pages

1. Repo **Settings > Pages**
2. Source: **Deploy from a branch**, branch `main`, folder `/ (root)`
3. Open `https://<username>.github.io/Smart-Dustbin-Embedded-System/website/`

Everything works on Pages. The Node server is optional and not used there.

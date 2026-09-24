# 16. Website and Admin Dashboard

The `website/` folder is a complete front end for the system: a public status
page anyone can see, a password-protected console for managing a fleet of bins
across a city, and a page for the crew who actually empty them.

It is **static** - plain HTML, CSS and JavaScript with no build step - so it
runs by double-clicking a file and deploys to GitHub Pages unchanged. The data
everyone shares lives in Firestore, which the pages talk to directly; there is
still no server of our own.

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

## The pages

### Public site - `index.html`

Open to everybody, read only.

- Hero and explanation of how the system works
- Live city KPIs: bins deployed, normal, near full, needing collection, average fill
- An interactive map of all 48 bins, colour-coded by status
- A sortable table of every bin with fill bars and last-seen times
- A status pill saying whether the numbers are live from the cloud or this
  browser's own copy
- Sections on industry relevance and the technology used

It loads no authentication SDK at all, so the cloud subscription has to work
signed out - which is why `bins` is world-readable in the Security Rules.

### Admin console - `admin.html`

Requires a login. `AUTH.requireAuth()` runs before anything renders, so an
unauthenticated visit is redirected to `login.html` immediately. A collection
crew session is sent to `collector.html` instead, because the fleet console is
not their page:

```js
AUTH.requireAuth("login.html", { allow: ["owner", "admin", "viewer"],
                                 elsewhere: { collector: "collector.html" } });
```

| Panel | What it does |
|---|---|
| **KPI row** | Fleet totals including offline devices |
| **City map** | Click any bin to select it; zone filter and fit-all |
| **Control panel** | Live readings for the selected bin plus remote commands |
| **Fleet actions** | Mute every full bin, plan a collection route, reset the demo |
| **Activity feed** | Timestamped log of every status change and command |
| **Fleet inventory** | Searchable, filterable table with a per-row Collect button |
| **Live firmware simulation** | The browser twin - sliders, animated bin, serial console, lockdown readout |
| **Wokwi embed** | Paste your Wokwi project ID to embed the real simulator |
| **Live device** | A real ESP32's readings, arriving through Firestore. A folded-away panel still polls a board by IP for bench work |

### Crew page - `collector.html`

Deliberately narrow: the route, and nothing else. No bulk commands, no muting,
no resetting, no user management - and the Firestore rules refuse those too,
so the page is not the only thing standing in the way.

| Panel | What it does |
|---|---|
| **Sign-in card** | One shared crew password, plus your own name for the activity log |
| **KPI row** | Due now, near full, stops, estimated km and minutes, litres against the truck's capacity |
| **Route map** | Numbered stops with the route drawn between them |
| **Plan** | Start point, zone filter, truck capacity, stops per Maps link, whether to include near-full bins, offline bins, and a return leg |
| **Stop list** | Each stop with its fill, a LOCKED badge where the lid is refusing hands, and two buttons: Open lid (crew override) and Mark collected |
| **Legs** | One "Open in Google Maps" button per leg |

Owners and administrators are let straight in, because somebody has to be able
to check what the crew are seeing.

---

## Remote commands

Selecting a bin and pressing a button sends the same command set the firmware
accepts over serial:

| Button | Command | Effect |
|---|---|---|
| Open lid | `OPEN` | Forces the lid open, enters manual override. On a bin that is locked because it is full, this is the crew override, and the reply says so |
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

The planner lives in `assets/js/route.js` and is used by both the dashboard's
**Fleet actions > Plan collection route** and the crew page. It is pure - no
DOM, no clock, no randomness - so every number it produces can be checked
under Node, which is what `tests/route.test.js` does.

It works in two stages.

**1. Nearest neighbour.** From the start, always drive to the closest bin not
yet visited. Fast and obvious, and it has a known weakness: it paints itself
into corners and leaves long jumps at the end, which appear on the map as
lines crossing each other.

**2. 2-opt.** Take every pair of legs `A->B ... C->D`. If turning them into
`A->C ... B->D` - that is, reversing the stretch between them - is shorter, do
it. Repeat until nothing helps. A route that crosses itself can **always** be
shortened this way, so 2-opt removes every crossing.

Finding the truly shortest order is the Travelling Salesman Problem: twenty
bins already have 20! orders, about 2.4 x 10^18, so there is no exact answer
to be had in a browser. A two-stage heuristic that lands within a few percent
is what real fleet software uses as well, and being able to say *why* the
first stage is not good enough on its own is the interesting part.

Distances are straight lines on the globe (the haversine formula, mean Earth
radius 6371.0088 km, rather than the old 111 km per degree approximation).
Roads are longer than straight lines, so the estimate multiplies by **1.35**,
a common detour factor for a city grid. The time estimate is **22 km/h plus
four minutes a stop**. These are estimates, and the page says so.

### Handing the route to Google Maps

Each leg becomes a `https://www.google.com/maps/dir/?api=1` link. There is no
API key and nothing to bill, and on a phone the link opens the Google Maps app
if it is installed.

Three facts from Google's documentation shape the code:

- **Nine waypoints per link on a computer or in the Maps app, three in a
  mobile browser.** So the route is split into legs, and "Stops per link" is a
  setting with exactly those two values.
- **Leaving the origin out means "start from where I am".** That is the
  default, together with `dir_action=navigate`, so a driver gets turn-by-turn
  from the cab instead of a preview from the depot. A dispatcher planning on a
  computer can switch the origin back on with one checkbox.
- **Google does not reorder waypoints.** It drives them in the order given -
  which is exactly why the ordering has to be done here first.

Coordinates go in as `lat,lng` to six decimals, with the comma encoded as
`%2C` and the waypoint separator `|` as `%7C`.

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
| **90%** or **Full** | The bin locks: a padlock on the bin front, "LOCKED - FULL" above it, and the hand slider no longer opens the lid |
| **Uneven pile (A 90 / B 10)** | Fused 50 %, `UNEVEN LOAD` raised, sloped waste surface |
| **Unplug sensor A** | `sensors 1 / 2`, degraded mode still reporting |
| **Reset sensors** | Back to an empty, even bin |

Two readouts were added for the lockdown: **Full lockdown** (`no` / `LOCKED`)
and **Turned away**, the count of approaches refused. Drag the hand slider
under 25 cm on a full bin and the console prints
`### Bin FULL - lid locked until it is emptied` **once**, not once per poll -
the refusal is latched until the hand goes away again. Type `OPEN` into the
console and the lid opens anyway, with the reply naming the override.

`node tests/twin.test.js` asserts that this twin behaves identically to the
firmware, with 88 checks.

> The twin is the reference. When the lockdown was added it was written here
> first, the tests were written against it, and the four firmware builds - the
> ESP32 sketch, the UNO sketch, the modular `src/` build and the Tinkercad
> sketch - were then made to match it line for line, along with the fleet
> model behind the map. If you change a threshold in the `.ino`, change it in
> `sim.js` too; the tests exist to catch you when you forget.

---

## Connecting a real ESP32

The board reports **through the cloud**, not to your browser.

1. Create a Firebase account for the board (Authentication > Users), copy
   `arduino_code/05_esp32_wifi_version/secrets.example.h` to `secrets.h`
   beside the sketch and fill in that address and password.
2. Put `{ "<device uid>": "BIN-001" }` into `DEVICE_BINS` in
   `firebase-config.js` and into `deviceBins()` in `firestore.rules`, and
   publish the rules.
3. Flash the sketch. It prints `Cloud: sync ON - reporting to Firestore
   bins/BIN-001` at boot, and `CLOUD` typed at the serial monitor shows
   whether it is signed in, when it last pushed, and the last HTTP code.

That bin then shows up as a **device** bin on every dashboard, anywhere, and
commands sent from the dashboard are picked up by the board within about ten
seconds. A board that has not reported for two minutes is shown offline, which
is what a real system does.

### Why this replaced polling the board directly

The old route was `http://<the bin's ip>/api/status`, every three seconds,
from the dashboard. Two problems, and the second one is fatal:

- Your laptop had to be on the same Wi-Fi as the bin. That is fine on a bench
  and meaningless for a bin on a street.
- The live site is served over **HTTPS**, and a page served over HTTPS is not
  allowed to fetch `http://`. The browser blocks it as **mixed content**
  before the request ever leaves the page, which looks exactly like the board
  being down.

Going through Firestore fixes both: the board makes an outbound TLS connection
to Google from wherever it is, and the browser only ever talks to Google.

The direct-IP panel is still on the dashboard, folded away under "Same Wi-Fi,
no cloud (direct IP)", because it is genuinely useful on a local `http://`
page while you are testing. The line that makes *that* work is still in the
sketch:

```c
server.sendHeader("Access-Control-Allow-Origin", "*");
```

Without that CORS header the browser fetches the data and then refuses to let
the page read it - which also looks exactly like a network failure and is not.

---

## Where the data lives

Three layers, and it is worth being precise about which is which.

**The fill levels are computed, not stored.** `data.js` models each bin's fill
as a pure function of the clock - a zone rate, a per-bin factor from a hash of
the id, a cycle that restarts an hour after the bin reaches 100 %. Every
browser therefore computes the same numbers from `Date.now()` with no database
involved. Two screens side by side agree, and nothing has to be written.

**What people and boards did is stored in Firestore.** A collection, a lid
override, a mute, a real device reading: a clock cannot know those, so they
live in `bins/{binId}` as a small overlay that `fleet-cloud.js` streams in and
lays over the computed values. The activity log is a second collection,
`events`. That is the only place a display name appears, because `bins` is
world-readable.

**With no cloud, the overlay falls back to `localStorage`**, so commands still
survive a reload and the demo still runs from a `file://` URL with no setup at
all. The status pill says **Local demo** so nobody believes a collection was
shared when it was not. **Reset demo data** clears this browser's copy and
does not touch the cloud.

Run `server/server.js` instead and the same pages are served by a real backend
with server-side sessions and authenticated REST endpoints.

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
| Two project owners (Google) | Owner | **Yes** | **Yes** |
| Four teammate accounts (Google) | Administrator | **Yes** | No |
| The shared crew password on `collector.html` | Collector | Only on the route | No |
| Demo credentials on the login page | Viewer | No | No |
| Any other Google account | *refused* | — | — |

Six named accounts have administrator access, two of them owners. Everyone else is either
read-only or turned away, and `DEFAULT_ROLE_FOR_UNKNOWN: "deny"` is what
makes an unrecognised Google account a refusal rather than a guest pass.

The crew are not in the registry, because they are not individuals. They are
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

A collector sits below both, and the split is the same kind of reasoning one
step further down. They can do exactly two things to a bin, and only to a bin
on their route: force the lid of a full one open so they can empty it, and
mark it collected. Not mute a buzzer, not PING a dead device, not run a
fleet-wide command, not reset anything. **It is enforced twice** &mdash; the
page does not offer it, and `firestore.rules` refuses the write if somebody
asks for it by hand. The second one is the one that counts, and it is the
reason the crew sign in to a real Firebase account rather than being checked
by a password comparison in JavaScript.

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

`firestore.rules` is no longer only about the admin list. It is now the
authorisation for everything the site writes:

| Who | Recognised by | May write |
|---|---|---|
| **Owner** | UID in `ownerUids()`, verified address | every staff field on any bin, plus the admin registry |
| **Administrator** | verified address whose SHA-256 has a registry document saying `owner`/`admin` | every staff field on any bin |
| **Collector** | UID in `collectorUids()` | `collectedAt` with `collectedByRole: "crew"`, and a lid override. Not mute, not PING, and it cannot claim to be an administrator |
| **Device** | UID is a key of `deviceBins()`, mapped to one bin | the `device` readings and `commandAck` of **its own bin only** |
| Anybody else | — | nothing. Being signed in, including anonymously, earns nothing |

Two details worth knowing for a viva. **No write may backdate itself**:
wherever a timestamp is set - a collection, a device report, a command - it
has to equal `request.time`, so no client can claim a bin was emptied an hour
ago. And **`bins` is world-readable**, which is why no name, address or UID
ever goes into it; the activity log is a separate collection that only staff
and crew may read.

#### Setup

The code is finished. The Firebase project is not, and **until step 1 is done
every page falls back to its own local simulation** - which is exactly what
the live site does today. Nothing is broken and nothing is shared; each page
says which it is on, on its status pill.

All of this is in the Firebase console for project `sdbs-399da`. The full
click-path, with the reasoning for each step, is in
`website/assets/js/firebase-config.js`.

1. **Publish the rules.** Firestore Database > Rules, paste `firestore.rules`
   from the repository root, press **Publish**. This is the step that makes
   the fleet live. Until it is done the production default denies everything,
   `fleet-cloud.js` gets `permission-denied` on its very first subscription,
   and the pill turns red with that explanation.
2. **Authorised domains.** Authentication > Settings > Authorised domains >
   add `snischayprasad.github.io` (`localhost` is there already). Without it,
   sign-in fails on the live site with an error that names the domain rather
   than the setting, which is an easy half hour to lose.
3. **Enable Email/Password.** Authentication > Sign-in method >
   Email/Password > Enable. Leave "Email link" off - the crew use a password.
   Google sign-in stays exactly as it is for owners and administrators; this
   is an additional provider, not a replacement.
4. **Create the crew account.** Authentication > Users > Add user, address
   `crew@sdbs-399da.firebaseapp.com`, password of your choosing - tell the
   crew, and write it down nowhere in this repository. Copy the new UID into
   **both** `COLLECTOR_UIDS` in `firebase-config.js` and `collectorUids()` in
   `firestore.rules`, **publish the rules again**, then confirm the two files
   agree:

   ```bash
   node tools/check-owners.js
   ```

   The address is a `firebaseapp.com` one on purpose: it is a login, not a
   mailbox, and nothing is ever sent to it.

5. **Optional - a real board.** Only needed for a physical ESP32 or a Wokwi
   project. Add a second user for the device, copy
   `arduino_code/05_esp32_wifi_version/secrets.example.h` to `secrets.h`
   beside the sketch and fill it in, then put `{ "<device uid>": "BIN-001" }`
   into `DEVICE_BINS` and into `deviceBins()`, and publish again. One account
   per board, mapped to the one bin it may report for, so a board that is
   somehow compromised still cannot file readings for any other bin.
6. **Finish on `users.html`.** Signed in as an owner, press **Sync registry to
   cloud**. The database only recognises an administrator whose hash document
   exists in the cloud, so a teammate committed in `users.js` and never synced
   gets the admin screen and is then refused on every write. Then press **Run
   check** and work down any line that says TODO: it verifies that the rules
   are published, that you are signed in as an owner, whether the crew and
   device accounts are configured, and how many committed administrators are
   missing from the cloud registry.

Steps 1 and 4 are the ones that are easy to half-do. An empty allow-list
allows nobody, which is correct behaviour - so a crew page that signs in
happily and then has every write refused means step 4 was done in one file and
not the other. `node tools/check-owners.js` exists to say which:

```
  Collection crew (COLLECTOR_UIDS / collectorUids)
    firebase-config.js : (none)
    firestore.rules    : (none)
    Not configured yet - empty in both files, which is consistent.
```

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
emulator - see "Testing" near the end of this document.

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

It also pins down what a collector may not do — no bin control, no bulk
commands, no resetting, no user management — and that nobody in the registry
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
is **authentication**: it establishes who is asking, and nothing about what
they are allowed to do.

The authorisation is `firestore.rules`, and that part is real. Google's
servers, not this page, decide whether a write lands. Forge a session in
`localStorage`, call the REST API by hand, re-enable the buttons the page
disabled — a collection, a lid override or a device reading is still refused
before it reaches the database.

What the rules do not cover is the part that never reaches the database. The
simulated fill curve is computed in each browser from the clock, so somebody
can make their own copy of the page display whatever they like; it simply does
not travel to anybody else. And the demo login on `login.html` is exactly what
the page says it is — credentials in downloadable JavaScript, which is why
that session is read-only.

Being able to draw those two lines — what a server checks, and what is only
presentation — is worth more in a viva than any single feature here.

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
| `route` | Haversine, that 2-opt only ever improves a route, the Maps URL format |
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
is needed: the project id is `demo-sdbs`, and the `demo-` prefix keeps the
emulator entirely local.

The suite makes three passes over the same file. The rules **as committed**.
The same file with test UIDs substituted into the crew and device allow-lists,
so those paths can be exercised before the real accounts exist. And a third
pass that loads `fleet-cloud.js` for real and sends every command the
dashboard can issue through the live rules - which is the pass that catches
the failure the other two cannot: both halves individually correct and
disagreeing with each other. If the rules expected `collectedByRole` while the
browser sent `collectedBy`, everything else would still be green and every
collection would still fail on a phone nobody is watching. Details in
`tests/rules/README.md`.

---

## File map

```
website/
├── index.html              Public status page
├── login.html              Admin sign-in
├── admin.html              Fleet dashboard
├── collector.html          The collection crew's route
├── users.html              Owner-only registry and cloud setup check
└── assets/
    ├── css/style.css       Theme tokens, layout, components
    ├── img/circuit.svg     Wiring diagram
    └── js/
        ├── data.js         Fleet model: clock-based fill, overlay, commands, log
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

The map uses Leaflet from a CDN. With no internet it falls back automatically
to a simple projected grid map, so bin selection still works offline - useful
when the exam hall Wi-Fi does not.

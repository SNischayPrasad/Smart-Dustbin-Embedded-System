# Smart Dustbin — Industry Oriented Embedded System

Touchless automatic lid, dual-sensor waste-level monitoring, full-bin alerts,
and a live web dashboard for managing bins across a city.

![Platform](https://img.shields.io/badge/platform-ESP32%20%7C%20Arduino%20UNO-E7352C)
![Language](https://img.shields.io/badge/language-Embedded%20C%2FC%2B%2B-blue)
![Tests](https://img.shields.io/badge/tests-486%20passing-brightgreen)
![Build](https://img.shields.io/badge/ESP32%20build-90%25%20flash%20%7C%2014%25%20RAM-success)
![Simulation](https://img.shields.io/badge/hardware-not%20required-orange)

### ▶ [**See it live**](https://snischayprasad.github.io/Smart-Dustbin-Embedded-System/website/)

| | |
|---|---|
| **Public city dashboard** | https://snischayprasad.github.io/Smart-Dustbin-Embedded-System/website/ |
| **Try the firmware** | [Live simulator](https://snischayprasad.github.io/Smart-Dustbin-Embedded-System/website/#simulation) — no sign-in needed |
| **Admin console** | [/login.html](https://snischayprasad.github.io/Smart-Dustbin-Embedded-System/website/login.html) — demo sign-in `Nischay` / `Admin@123` gives a **read-only** session; fleet control requires Google sign-in as a registered administrator |
| **Collection crew page** | [/collector.html](https://snischayprasad.github.io/Smart-Dustbin-Embedded-System/website/collector.html) — the route for the truck, on a phone. Needs the shared crew password, or an owner/administrator session |

On the public page, scroll to **Try the firmware yourself** and press
**Uneven pile (A 90 / B 10)** — that one button demonstrates the whole point
of the dual-sensor design, and needs no sign-in.

> **Built on the ESP32**, so the bin has Wi-Fi and a REST API and the dashboard
> can drive a real board. An Arduino UNO build is included as an alternative.
>
> **No hardware? No problem.** Import `simulation/wokwi/diagram.json` into
> [wokwi.com](https://wokwi.com) and the whole circuit appears, fully wired -
> Wi-Fi included, via the simulator's built-in `Wokwi-GUEST` network.

---

## Overview

An ordinary dustbin is a passive container. This one senses, decides, acts and
reports:

1. **It opens itself.** An ultrasonic sensor on the front detects a hand within
   25 cm and a servo lifts the lid. Nobody touches a dirty surface.
2. **It knows how full it is.** Two more ultrasonic sensors *inside* the bin,
   on opposite diagonals, measure the empty air above the rubbish. Their
   readings are fused into one fill percentage.
3. **It escalates sensibly.** Green under 75 %, blinking red from 75 %, solid
   red plus a short chirp at 90 %.
4. **It stops taking rubbish once it is full.** From 90 % the lid no longer
   opens for a hand, so the next bag goes to the next bin along instead of
   on top of a pile that is already at the rim.
5. **It reports.** Telemetry over serial or Wi-Fi feeds a city dashboard that
   shows every bin on a map and lets an operator control them remotely. A
   real board reports through Firestore, so the dashboard and the bin never
   have to be on the same network.

---

## Problem statement

Two problems, one hygienic and one economic.

**Hygiene.** A public bin lid is one of the dirtiest surfaces in a building.
Every person who opens it passes whatever is on their hands to the next.
Removing the touch removes the pathway.

**Economics.** Waste collection normally runs on a *fixed schedule* — a van
visits every bin whether it needs it or not. Half the visits are to bins that
are nearly empty, which burns fuel and driver hours for nothing, while a
handful of bins in busy spots overflow long before the van is due. Fill-level
data replaces the timetable with evidence.

---

## Why two sensors inside the bin

This is the design decision worth understanding, because it is what separates
this project from the usual single-sensor smart bin.

**Rubbish is never flat.**

```
     [ sensor A ]                        [ sensor B ]
          |  ^                                |  ^
          |  | 3 cm                           |  | 27 cm
          |  v                                |  v
      ~~~~~~~~~~~~\
                   \~~~~~~~~~~~~~~~~~~~~~~~~~~~~
          ^ a peak                    a hollow ^
      ____|____________________________________|____   bin floor

   Sensor A alone says  90%  ->  "FULL, send a van"      (wrong)
   Sensor B alone says  10%  ->  "practically empty"     (wrong)
   Fused  (A+B)/2 says  50%  ->  correct, plus UNEVEN LOAD flagged
```

Two sensors on opposite diagonals buy three things at once:

| Benefit | How |
|---|---|
| **Accuracy** | Two points describe a lumpy surface far better than one |
| **Redundancy** | If one fails, the bin runs on the other and flags itself degraded, instead of going blind |
| **Diagnosis** | A gap of more than 25 points means the load is piled to one side — reported as `UNEVEN LOAD` |

Full worked numbers in [docs/12-bin-level-calculation.md](docs/12-bin-level-calculation.md).

---

## Why a full bin locks its lid

Until recently the bin reported `FULL`, lit the red LED, chirped - and then
opened its lid to the next person anyway. That is the failure everybody has
seen in a railway station: a bin at the rim, three bags balanced on top, and
the rest on the floor around it. An alert nobody is standing next to does not
stop the next bag going in. Refusing to open does.

So from 90 % the lid stays shut for a hand. The refusal is counted and printed
once per approach, not once per sensor poll:

```
### Bin FULL - lid locked until it is emptied
[52s] Hand=10.2cm | Lid=CLOSED | A=92% B=90% | Fill=91% | Status=FULL | Opens=7 | LOCKED
{"id":"BIN-001",...,"status":"FULL","locked":true,"refused":1,...}
```

**There are exactly two ways past the lock, and both are deliberate.**

| Exception | Why it exists |
|---|---|
| **The safety re-open** | If a hand comes back while the lid is already coming down, the lid re-opens - even if the bin went full in the meantime. A lid must never close on somebody's hand. Safety beats lockdown, and there is deliberately no lock test in the `CLOSING` branch. |
| **The crew's `OPEN` override** | The collection crew have to open a full bin to empty it. `OPEN` still works, and says so: `lid forced open (crew override - bin FULL)`. After `AUTO` the bin re-locks by itself the moment the lid is closed again. |

`EMPTY` clears the lock and resets the refusal count. So does the level simply
dropping below 90 %, because a crew that empties a bin without sending the
command must not be punished for it - nothing stores a lock flag, it is
recomputed from the status every pass, so there is nothing that can get stuck.

**A sensor fault does not lock.** With both in-bin sensors dead the bin has no
idea how full it is, and stranding every user on a guess is worse than an
occasional overfill. Fail usable, not fail shut.

The same rule runs in six places - the browser twin, the ESP32 sketch, the UNO
sketch, the modular `src/` build, the Tinkercad sketch and the fleet model -
and `tests/twin.test.js` is what keeps them honest. Test cases TC-20 to TC-26
in [docs/13-testing-strategy.md](docs/13-testing-strategy.md) walk through each
path on real hardware.

---

## Features

- Touchless lid on a **four-state machine** with a safety re-open if a hand
  returns mid-close
- **Full-bin lockdown** — from 90 % the lid refuses a hand and counts the
  refusals, with the safety re-open and the crew's `OPEN` override as the two
  deliberate exceptions
- **Dual in-bin level sensors** fused into one percentage, with uneven-load
  detection and graceful single-sensor degradation
- Three-band alert policy — green / blinking red / solid red plus a 200 ms
  chirp every 2 s (not a continuous siren, which staff disable)
- **Non-blocking cooperative scheduler** — effectively no `delay()` in `loop()`
- Median-of-three filtering, range validation, echo timeouts, honest
  `SENSOR_ERROR` reporting
- Power-on self test that pings all three sensors and reports which answered
- Serial command set: `OPEN CLOSE AUTO MUTE UNMUTE EMPTY PING STATUS WIFI
  CLOUD HELP` (the last three on the ESP32)
- Optional 16x2 I2C LCD, compiled out entirely with one `#define`
- ESP32 variant exposing a REST API, **plus cloud sync** — a FreeRTOS task on
  core 0 reports telemetry into Firestore and takes commands back, so `loop()`
  on core 1 never waits on an HTTPS call
- **Public website + admin dashboard** with a live city map of 48 bins, remote
  commands and a collection-route planner
- **Live shared data** — Firestore holds what people and boards actually did,
  and every open browser sees it within a second
- **A crew page** with a nearest-neighbour + 2-opt route and Google Maps
  hand-off, built for a phone in a truck
- **In-browser firmware simulator** on both pages — the real state machine
  ported to JavaScript, driven by three sensor sliders
- **Sign in with Google** (OAuth 2.0 / OIDC) with the ID token's RS256
  signature verified in-browser against Google's JWKS — not just decoded
- **Four roles** — owner, administrator, collector, viewer — from a user
  registry where every address is stored as a hash; the public demo login is
  read-only
- **Owner-only user management console** that hashes new addresses in-browser
  and generates the registry file to commit
- **Firestore Security Rules as the real authorisation** — owner, admin, crew
  and device each get exactly what they need and nothing more, enforced on
  Google's servers rather than by the buttons the page happens to hide
- **486 automated tests** in 7 suites, plus 99 Security Rules assertions run
  against the Firebase emulator

---

## Hardware

| Component | Qty | Purpose |
|---|---|---|
| **ESP32 DevKit V1** (or Arduino UNO) | 1 | Controller, Wi-Fi |
| HC-SR04 ultrasonic sensor | **3** | 1 hand detection + 2 in-bin level |
| SG90 servo motor | 1 | Lifts the lid |
| Green LED + 220 ohm | 1 | Normal status |
| Red LED + 220 ohm | 1 | Warning / full |
| Active buzzer | 1 | Full-bin alert |
| 16x2 I2C LCD | 1 | Local readout (optional) |
| 1 kΩ + 2 kΩ resistors | 3 pairs | ECHO level shifting (ESP32 only) |
| Breadboard, jumpers, 5 V/2 A supply | - | - |

Approximate total **1,500 INR** (the ESP32 is cheaper than an UNO). Zero if you simulate.

---

## Circuit

![Circuit diagram](circuit_diagram/smart_dustbin_circuit.svg)

| Component | ESP32 GPIO | Arduino UNO pin |
|---|---|---|
| HC-SR04 #1 (hand, outside) | TRIG **5**, ECHO **18** | D2 / D3 |
| HC-SR04 #2 (level A, inside) | TRIG **19**, ECHO **23** | D4 / D5 |
| HC-SR04 #3 (level B, inside) | TRIG **32**, ECHO **33** | D8 / D9 |
| Servo signal | **13** | D6 |
| Buzzer | **25** | D7 |
| Green LED | **26** via 220 Ω | D10 |
| Red LED | **27** via 220 Ω | D12 |
| LCD | **21** SDA, **22** SCL | A4 / A5 |

> **On real ESP32 hardware, fit a 1 kΩ / 2 kΩ divider on each of the three
> ECHO lines.** The HC-SR04 drives 5 V and ESP32 GPIOs are 3.3 V only.
> Not needed on the UNO, and not needed in simulation.

Full tables, mounting guidance, the Wokwi pin-naming trap and the power
budget: [circuit_diagram/connections.md](circuit_diagram/connections.md).

---

## Embedded concepts demonstrated

| Concept | Where |
|---|---|
| GPIO input / output | TRIG, ECHO, LEDs, buzzer |
| Microsecond pulse timing | `pulseIn()` on the echo line |
| PWM | Servo angle control |
| Finite state machine | 4-state lid controller |
| Cooperative scheduling | `millis()` task dispatch, no `delay()` |
| Sensor fusion | Averaging two in-bin sensors plus a disagreement flag |
| Signal filtering | Median-of-three spike rejection |
| Threshold logic and status bands | 25 cm / 75 % / 90 % |
| Interlock with prioritised exceptions | Full-bin lockdown, overridden by the mid-close safety re-open and by `OPEN` |
| Calibration | Measuring the true empty-bin distance |
| Fault handling | Timeouts, sentinels, degraded mode, error blink |
| UART protocol design | Human line plus JSON line telemetry |
| Conditional compilation | `#ifdef USE_LCD` feature flag |
| Wireless / IoT | Wi-Fi station mode, HTTP server, REST API with CORS |
| RTOS task, queues, critical section | Cloud sync pinned to core 0; a queue hands commands to `loop()` on core 1 so servo writes stay on one core |
| Cloud protocol over TLS | Firestore REST, bearer token with refresh, server-timestamped writes |

---

## Bin level formula

```
fillLevel   = BIN_HEIGHT_CM - measuredDistance
fillPercent = (fillLevel / BIN_HEIGHT_CM) x 100
fused       = (fillA + fillB) / 2
uneven      = |fillA - fillB| > 25
```

With `BIN_HEIGHT_CM = 30`:

| Distance | 30 cm | 22.5 cm | 15 cm | 7.5 cm | 3 cm | 0 cm |
|---|---|---|---|---|---|---|
| **Fill** | 0 % | 25 % | 50 % | 75 % | 90 % | 100 % |
| **Status** | OK | OK | OK | WARNING | FULL | FULL |

---

## The city fleet: 48 bins, and the same numbers on every screen

The dashboard shows **48 bins** across 36 zones of Hyderabad - railway
stations, markets, hospitals, parks, a campus - with real coordinates. Two of
them (`BIN-012` and `BIN-038`) are offline on purpose, because a fleet where
every device answers is not a fleet anybody has operated.

Only one of those bins can be a real board, so the rest are simulated. The
interesting part is **how**. Each bin's fill is a pure function of the clock:

```
fill = residual + rate_per_hour x hours_since_this_bin_was_last_emptied
```

The rate comes from the zone (a railway station fills at 40 % an hour, a park
at 10), scaled by a factor between 0.8 and 1.2 derived from a hash of the bin
id, so no two bins move in step. When a bin reaches 100 % a simulated crew
empties it an hour later and the cycle restarts.

Nothing about that needs storing. Open the site on a laptop and a phone at the
same time and both compute the identical number from `Date.now()`, with zero
database writes. The previous version random-walked a private fleet in each
browser's `localStorage`, which meant two screens side by side disagreed - and
which, once the data was shared, would have meant every open tab writing its
own random numbers into Firestore and burning the free tier by lunchtime.

**So the database stores only what a clock cannot know: what people and boards
actually did.** A collector marking a bin emptied, an administrator forcing a
lid open, an ESP32 reporting 72 %. Those are facts about the world, and they
have to travel.

---

## Live cloud data

`bins/{binId}` in Firestore holds a small **overlay** per bin - when it was
last collected and by which role, whether a lid is under manual override,
whether it is muted, and the latest reading from a real device. `data.js`
computes the simulated numbers, `fleet-cloud.js` streams the overlay in over a
single `onSnapshot`, and the overlay wins. A second collection, `events`,
carries the activity log, which is the only place a person's display name
appears - `bins` is world-readable, so no names, addresses or UIDs go in it.

**`firestore.rules` is the authorisation, not the interface.** Every other
check in this project runs in the browser and therefore decides what the page
*offers*. These rules run on Google's servers and decide what the database
*does*:

| Who | Recognised by | May write |
|---|---|---|
| **Owner** | UID in `ownerUids()`, verified address | every staff field on any bin, the admin registry |
| **Administrator** | verified address whose SHA-256 has a registry document saying `owner`/`admin` | every staff field on any bin |
| **Collector (crew)** | UID in `collectorUids()` | `collectedAt` + `collectedByRole: "crew"`, and a lid override - not mute, not PING, and it cannot claim an administrator's role |
| **Device (a board)** | UID is a key of `deviceBins()`, mapped to one bin | the `device` readings and `commandAck` of **its own bin only** |
| Anyone else | - | nothing. Being signed in, including anonymously, earns nothing |

No write may backdate itself: wherever a timestamp is set it has to equal
`request.time`, so a client cannot claim a bin was collected an hour ago.

**This is also what unplugged the dashboard from the bin's Wi-Fi.** A real
ESP32 used to be reachable only by polling `http://<its ip>/api/status`, which
meant your laptop had to be on the same network as the bin - and on the live
HTTPS site the browser blocked the request as mixed content before it left the
page. Now the board signs in to Firebase itself and writes its readings into
its own bin document, over TLS, from wherever it is. The direct-IP panel is
still on the dashboard for bench work on a local `http://` page, which is the
only place it ever really worked.

---

## The collection crew's page

`collector.html` is a separate, crew-only page, built for a phone in a truck.
It shows which bins are due, in what order, and hands the route to Google Maps.

The ordering is the classic two-stage heuristic. **Nearest neighbour** builds a
first route - always drive to the closest bin not yet visited - which is fast
but paints itself into corners and leaves long jumps at the end. **2-opt** then
looks at every pair of legs and reverses the stretch between them when that is
shorter, repeating until nothing helps. Any route that crosses itself can
always be shortened that way, so 2-opt removes every crossing on the map. The
exact answer is the Travelling Salesman Problem; twenty bins already have
20! orders, so a heuristic within a few percent is what real fleet software
uses too.

Straight-line distances come from the haversine formula and are scaled by 1.35
for city roads; the time estimate is 22 km/h plus four minutes a stop.

**Google Maps does the actual driving.** Each leg becomes a
`https://www.google.com/maps/dir/?api=1` link - no API key, nothing to bill.
Google accepts nine waypoints per link on a computer or in the Maps app and
only three in a mobile browser, so the route is split into legs and "Stops per
link" is a setting. The origin is left out by default, which makes Google start
turn-by-turn from wherever the phone already is. Google does not reorder
waypoints, which is exactly why the ordering is done here first.

Per stop the crew get **Open lid (crew override)** - the same override the
firmware honours on a locked bin - and **Mark collected**, which writes back to
the shared fleet so the city dashboard and every other crew phone drop that bin
off the list within a second. With no network, or before the rules are
published, planning and marking still work on that phone and the status pill
says plainly that the changes are not being shared.

---

## Quick start

### Simulate (no hardware)

1. Open [wokwi.com](https://wokwi.com), then **New Project > ESP32**
2. Paste [`simulation/wokwi/diagram.json`](simulation/wokwi/diagram.json) into the **diagram.json** tab
3. Paste [`simulation/wokwi/sketch.ino`](simulation/wokwi/sketch.ino) into the **sketch.ino** tab
4. Install **ESP32Servo** and **LiquidCrystal I2C** when prompted
5. Press play, then click a sensor to change its distance

Wi-Fi works in the simulator via `Wokwi-GUEST`, so the built-in status page
and the REST API are live. Add a `secrets.h` tab (copy
[`simulation/wokwi/secrets.example.h`](simulation/wokwi/secrets.example.h))
and the simulated board reports into Firestore as well, which puts it on the
live dashboard as a real device. Keep that Wokwi project **private** - a
public one shows every tab, including `secrets.h`, to anyone who opens it. An
Arduino UNO variant is in
[`simulation/wokwi/uno/`](simulation/wokwi/uno/).

### Real hardware - ESP32

1. Arduino IDE: add the ESP32 board package, install **ESP32Servo** and
   **LiquidCrystal I2C**
2. Wire per the table above, **including the three ECHO dividers**
3. Board: **ESP32 Dev Module**. Open
   `arduino_code/05_esp32_wifi_version/` and upload
4. Serial Monitor at **115200 baud**, line ending **Newline**
5. Put your own Wi-Fi SSID and password at the top of the sketch
6. Optional, for cloud sync: copy `secrets.example.h` to `secrets.h` beside
   the sketch and fill in the board's own Firebase account. The sketch turns
   cloud sync on the moment that file exists and compiles it out again when it
   does not. `secrets.h` is git-ignored; type `CLOUD` on the serial monitor to
   see whether the board is signed in and when it last pushed

### Real hardware - Arduino UNO

1. Install the **Servo** and **LiquidCrystal I2C** libraries
2. Open `arduino_code/04_smart_dustbin_complete/` and upload
3. Serial Monitor at **9600 baud**, line ending **Newline**

### Website and dashboard

```bash
node server/server.js
```

Open <http://localhost:3000>, or just double-click `website/index.html`.

Admin login: **`Nischay`** / **`Admin@123`**

The crew page is `website/collector.html`. An owner or administrator session
opens it straight away; anybody else is asked for the shared crew password.

### Run the tests

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

Every suite also runs on its own - `node tests/twin.test.js` and so on. The
Security Rules have a separate suite, because it needs the Firebase emulator
and a Java runtime:

```bash
cd tests/rules && npm install && npm test
```

```
  99 passed, 0 failed
```

---

## Setup still to do

The code is finished. The Firebase project is not, and **until step 1 is done
every page falls back to its own local simulation** - which is exactly what
the live site does today. Nothing is broken and nothing is shared; the pages
say so on a status pill rather than pretending.

All of this is in the Firebase console for project `sdbs-399da`.

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
   **both** `COLLECTOR_UIDS` in `website/assets/js/firebase-config.js` and
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

Steps 1 and 4 are the ones that are easy to half-do: an empty allow-list
allows nobody, which is correct, so a crew page that signs in happily and then
has every write refused means step 4 was only done in one of the two files.

---

## Sample output

```
==================================================
   SMART DUSTBIN - EMBEDDED SYSTEM (ESP32)
   Device  : BIN-001
   Firmware: v2.0.0-wifi
   Sensors : 1 hand + 2 in-bin level (A and B)
   Bin height     : 30.0 cm
   Hand threshold : 25.0 cm
   Warn / Full    : 75 % / 90 %
   Uneven-load gap: 25 %
   Full lockdown  : ON (crew override: OPEN)
==================================================
Power-on self test ... outputs OK
Sensor check: HAND OK | LEVEL-A OK | LEVEL-B OK
Connecting to Wi-Fi...
Connected. Dashboard URL: http://10.13.37.2
HTTP server started on port 80
Cloud: sync ON - reporting to Firestore bins/BIN-001
System running. Type HELP for commands.

>>> Hand detected - opening lid
[32s] Hand=12.0cm | Lid=OPEN | A=88% B=14% | Fill=51% | Status=OK | Opens=1 | UNEVEN LOAD
        [##########----------]
{"id":"BIN-001","fill":51,"fillA":88,"fillB":14,"spread":74,"uneven":true,"sensors":2,...}
```

With no `secrets.h` beside the sketch that one line reads `Cloud: sync OFF -
add secrets.h next to the sketch (copy secrets.example.h) to report to the
dashboards`, and everything else is identical.

A full captured session is in
[`data/sample_serial_output.txt`](data/sample_serial_output.txt).

---

## Verification

Every sketch was compiled with `arduino-cli` against the real toolchains.

| Check | Result |
|---|---|
| `05_esp32_wifi_version` (ESP32) **with cloud sync** | 90 % flash, 14 % RAM |
| `05_esp32_wifi_version` (ESP32) without `secrets.h` | 75 % flash, 14 % RAM |
| `04_smart_dustbin_complete` (UNO) | 52 % flash, 41 % RAM |
| `01_lid_module` (UNO) | 5,434 B flash (16 %) |
| `02_bin_level_module` (UNO) | 6,318 B flash (19 %) |
| `03_alert_module` (UNO) | 4,056 B flash (12 %) |
| `src/` modular build (UNO) | 42 % flash, 39 % RAM |
| `tinkercad_sketch` (UNO, LCD removed) | 40 % flash, 22 % RAM |
| Compiler warnings (`--warnings all`) | none from project code |
| `node tools/run-tests.js` | 486 passed, 0 failed, in 7 suites |
| `cd tests/rules && npm test` | 99 passed, 0 failed (Security Rules, Firebase emulator) |
| Wokwi ESP32 circuit import | 11 parts, 27 connections, all 16 board pins resolve |

The fifteen points between the two ESP32 builds are the HTTPS client and
Google's root-certificate bundle, which is what lets the board verify it is
really talking to Firestore rather than trusting whatever answers. Adding
`secrets.h` is the only difference between the two rows.

---

## Project structure

```
Smart-Dustbin-Embedded-System/
├── src/                  Modular firmware (config, drivers, FSM, fusion)
├── arduino_code/         5 ready-to-upload sketches, built up in stages
├── simulation/           Wokwi circuit + Tinkercad instructions
├── circuit_diagram/      Wiring SVG, pin tables, power budget
├── website/              Public site + admin console + crew page
├── server/               Optional zero-dependency Node backend
├── tests/                486 logic assertions, plus tests/rules/ for Firestore
├── tools/                Test runner, owner/UID checker, hashing, cache-busting
├── data/                 Seed fleet, calibration table, captured output
├── docs/                 19 documentation sections
├── screenshots/          Proof images
├── reports/              Project report
└── firestore.rules       Who may write what - the only server-side check
```

[Full explanation of every folder](docs/08-folder-structure.md)

---

## Documentation

| # | Document |
|---|---|
| 01 | [Project explanation](docs/01-project-explanation.md) |
| 02 | [Industry relevance](docs/02-industry-relevance.md) |
| 03 | [Tech stack options](docs/03-tech-stack-options.md) |
| 04 | [Embedded concepts used](docs/04-embedded-concepts.md) |
| 05 | [Hardware components](docs/05-components.md) |
| 06 | [Project architecture](docs/06-architecture.md) |
| 07 | [Implementation plan](docs/07-implementation-plan.md) |
| 08 | [Folder structure](docs/08-folder-structure.md) |
| 09 | [Circuit diagram](docs/09-circuit-diagram.md) |
| 10 | [Source code guide](docs/10-source-code-guide.md) |
| 11 | [Virtual simulation](docs/11-virtual-simulation.md) |
| 12 | [Bin level calculation](docs/12-bin-level-calculation.md) |
| 13 | [Testing strategy](docs/13-testing-strategy.md) |
| 14 | [How to run](docs/14-how-to-run.md) |
| 15 | [GitHub strategy](docs/15-github-strategy.md) |
| 16 | [Website and dashboard](docs/16-website-guide.md) |
| 17 | [Proof building plan](docs/17-proof-plan.md) |
| 18 | [Screenshot checklist](docs/18-screenshot-checklist.md) |
| 19 | [Interview preparation](docs/19-interview-preparation.md) |

---

## Known limitations

Stated deliberately - knowing the boundaries of your design is part of the
engineering.

- **The servo is open loop.** There is no position feedback, so the firmware
  cannot detect a jammed lid. A limit switch or current sensing would fix it.
- **Two sensors sample two points, not a volume.** A narrow spike exactly
  between A and B is still invisible.
- **No temperature compensation.** The speed of sound shifts about 0.6 m/s per
  degree C - negligible indoors, a real error on a bin standing in the sun.
- **The lock is a refusal, not a latch.** The firmware declines to drive the
  servo; it cannot stop somebody lifting the lid by hand. That is the right
  trade for a public bin - a bin that physically cannot be opened is a bin
  that traps a child's arm - but it means the lockdown reduces overfilling
  rather than preventing it.
- **Authorisation is real now, but only as far as the database.** Firestore
  Security Rules run on Google's servers, and no amount of editing
  `localStorage` or calling the REST API by hand gets a collection, a lid
  override or a device reading past them. What they do not police is the part
  that never reaches the database: the simulated fill curve is computed in
  each browser, so a visitor can still make their own copy of the page say
  whatever they like. Being able to draw that line is the point.
- **Until `firestore.rules` is published, nothing is shared.** Every page
  falls back to its own local simulation and says so on a status pill. See
  "Setup still to do" above.
- **The route is a heuristic, and the truck is one truck.** Nearest neighbour
  plus 2-opt gets within a few percent of the best order, but there is no
  traffic data, no time windows, no multi-vehicle split, and the distances are
  straight lines scaled by a constant rather than real road lengths. Google
  Maps supplies the actual driving once the order is fixed.
- **Wi-Fi is the wrong radio for street furniture.** A real deployment would
  use LoRaWAN or NB-IoT with deep sleep.

---

## Future improvements

- Deep sleep plus LoRaWAN/NB-IoT for year-long battery life
- Limit switch or current sensing for closed-loop lid control
- Temperature-compensated speed of sound (DHT22)
- Tamper and fire detection (accelerometer plus thermistor)
- Signed over-the-air firmware updates
- Waste segregation using an inductive or capacitive sensor
- Solar charging for outdoor units

---

## Learning outcomes

- Reading a sensor by timing a pulse to microsecond accuracy
- Driving an actuator with PWM
- Designing a finite state machine, and why it beats a boolean
- Writing non-blocking firmware with a cooperative scheduler
- Fusing redundant sensors and degrading gracefully when one fails
- Calibrating against physical reality instead of trusting a datasheet
- Designing an alert policy people will not disable
- Writing an interlock and then deciding, on purpose, what is allowed to
  override it
- Keeping one rule identical across six implementations, and using tests to
  notice when it stops being identical
- Moving work off the critical path with an RTOS task and a queue instead of
  making `loop()` wait for the network
- Writing authorisation that runs on a server, and testing it in an emulator
  in both directions - what must be allowed as well as what must be refused
- Turning a routing problem into something a truck driver can follow
- Testing embedded logic automatically, including fault injection
- Building a front end that turns telemetry into an operational decision

---

## Author

**Sadhanala Nischay Prasad**


---

## License

MIT - see [`LICENSE`](LICENSE).

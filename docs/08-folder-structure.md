# 8. Folder Structure

```
Smart-Dustbin-Embedded-System/
|
├── src/                     Modular firmware (PlatformIO style)
│   ├── config.h             Every pin, threshold and timing constant
│   ├── ultrasonic.h/.cpp    HC-SR04 driver with median filtering
│   ├── lid.h/.cpp           Servo lid state machine
│   ├── bin_level.h/.cpp     Fill percentage maths and status bands
│   ├── alert.h/.cpp         LED and buzzer policy
│   ├── display.h/.cpp       Optional I2C LCD output
│   └── main.cpp             Entry point, cooperative scheduler
│
├── arduino_code/            Ready-to-upload .ino sketches
│   ├── 01_lid_module/            Module A - touchless lid only
│   ├── 02_bin_level_module/      Module B - fill percentage only
│   ├── 03_alert_module/          Module C - LEDs and buzzer only
│   ├── 04_smart_dustbin_complete/ Full system on Arduino UNO (alternative)
│   └── 05_esp32_wifi_version/    Full system on ESP32 + Wi-Fi  <-- PRIMARY
│       ├── 05_esp32_wifi_version.ino
│       └── secrets.example.h     Template: copy to secrets.h to turn on
│                                 cloud sync (secrets.h is git-ignored)
│
├── simulation/              Run the project with no hardware
│   ├── wokwi/                    ESP32 simulation (primary)
│   │   ├── diagram.json          Complete wiring, import into wokwi.com
│   │   ├── sketch.ino            Copy of the ESP32 firmware
│   │   ├── secrets.example.h     Same template, for a secrets.h tab
│   │   ├── libraries.txt         Libraries Wokwi should install
│   │   ├── wokwi.toml            Config for the VS Code extension
│   │   └── uno/                  The Arduino UNO variant
│   └── tinkercad/
│       ├── README.md             Step-by-step build instructions
│       └── tinkercad_sketch.ino  Version without the I2C LCD
│
├── circuit_diagram/
│   ├── smart_dustbin_circuit.svg     ESP32 wiring diagram (primary)
│   ├── smart_dustbin_circuit_uno.svg  Arduino UNO wiring diagram
│   └── connections.md            Pin tables, wiring order, power budget
│
├── website/                 Public site + admin console + crew page
│   ├── index.html                Public city status page
│   ├── login.html                Admin sign-in
│   ├── admin.html                Fleet dashboard with map and simulator
│   ├── collector.html            The collection crew's route, for a phone
│   ├── users.html                Owner-only registry and cloud setup check
│   ├── README.md                 How to run and extend the site
│   └── assets/
│       ├── css/style.css
│       ├── js/data.js            Fleet model: clock-based fill, overlay, commands
│       ├── js/fleet-cloud.js     The Firestore subscription and the writes
│       ├── js/firebase-config.js Project keys, owner/crew/device allow-lists
│       ├── js/auth-config.js     Google Client ID (edit this)
│       ├── js/users.js           User registry: who may sign in, and as what
│       ├── js/auth.js            Session handling and the demo login
│       ├── js/oauth.js           Google ID token verification (WebCrypto)
│       ├── js/oauth-ui.js        Google Sign-In button wiring
│       ├── js/user-store.js      The admin registry in Firestore
│       ├── js/user-admin.js      users.html: sync and the setup check
│       ├── js/map.js             Leaflet map with an offline fallback
│       ├── js/sim.js             Firmware twin + animated dustbin
│       ├── js/simulator.js       The simulator panel, shared by both pages
│       ├── js/route.js           Nearest neighbour + 2-opt + Maps links
│       ├── js/collector.js       Crew page behaviour
│       ├── js/public.js          Public page behaviour
│       ├── js/admin.js           Dashboard behaviour
│       └── img/circuit.svg
│
├── server/                  Optional Node backend (zero dependencies)
│   └── server.js                 Static hosting + session auth + REST API
│
├── tests/                   486 checks in 7 suites, no framework to install
│   ├── twin.test.js               88 checks of the firmware logic
│   ├── fleet.test.js             105 checks of the fleet model
│   ├── cloud.test.js             103 checks of the Firestore client
│   ├── route.test.js              58 checks of the route planner
│   ├── users.test.js              62 checks on access control
│   ├── store.test.js              44 checks of the admin registry
│   ├── oauth.test.js              24 checks that forged JWTs are rejected
│   └── rules/                    99 Security Rules assertions, run in the
│                                 Firebase emulator (needs Java; separate)
│
├── tools/                   Small Node scripts, no dependencies
│   ├── run-tests.js              Runs every suite and prints one summary
│   ├── check-owners.js           Owner / crew / device UIDs agree across files
│   ├── hash-email.js             SHA-256 an address for the registry
│   ├── set-client-id.js          Write the Google Client ID
│   └── bump-assets.js            Cache-bust CSS and JS after a push
│
├── data/                    Datasets and recorded results
│   ├── bins.json                 Seed fleet of 48 bins
│   ├── sample_serial_output.txt  Reference Serial Monitor capture
│   ├── calibration_table.csv     Distance to percentage mapping
│   └── test_results.csv          Fill this in during Phase 11
│
├── outputs/                 Generated results worth keeping
├── screenshots/             Proof images for the report and README
├── reports/                 Project report and viva material
├── docs/                    This documentation set (19 sections)
├── firestore.rules          Who may write what - the only server-side check
├── firebase.json            Rules path + emulator ports
├── .firebaserc              The Firebase project id
├── .gitignore
└── README.md
```

---

## What each folder is for

### `src/`
The firmware written the way a production codebase is organised: one concern
per file, a header declaring the interface, a `.cpp` implementing it, and a
single configuration header that every module includes. This is the version to
show when somebody asks whether you can write structured embedded C.

### `arduino_code/`
The same logic packaged as self-contained `.ino` sketches you can open and
upload with no build system at all. Sketches 01 to 03 exist so you can bring
the system up one subsystem at a time; **05 is the primary complete product**
on the ESP32; 04 is the same system on an Arduino UNO for anyone without an
ESP32.

Note that 01 to 03 use the UNO pin map. On an ESP32 either edit the pin
constants at the top of each, or skip straight to 05 - it prints a per-sensor
self test at boot that tells you which sensors are answering.

Arduino requires the folder name and the sketch name to match, which is why
each sketch sits in its own directory.

Sketch 05 also carries `secrets.example.h`. Copy it to `secrets.h` in the same
folder and the firmware compiles cloud sync in; delete it and cloud sync
compiles out again, because the sketch tests for the file with
`#if __has_include("secrets.h")`. `secrets.h` itself is in `.gitignore` and
must stay there - it holds the board's Firebase password.

Sketches 01 and 02 say in their header comments that they deliberately have no
full-bin lockdown: 01 has no level sensor and 02 has no lid, so neither has
both halves of the rule. It first appears in 04 and 05.

### `simulation/`
Everything needed to run and demonstrate the project without owning any
hardware. `diagram.json` is the actual Wokwi wiring file - importing it
reproduces the whole circuit instantly.

### `circuit_diagram/`
The wiring reference. The SVG is vector, so it stays sharp when printed into a
report, and `connections.md` carries the tables, the assembly order, the power
budget and the fault table.

### `website/`
The public status page, the admin console and the collection crew's page.
Static files only, so it works by double-clicking `index.html`, and it deploys
to GitHub Pages unchanged.

There is no build step and no npm install, so every file in `assets/js/` is
the file the browser runs. The three that are new are worth knowing apart:
`fleet-cloud.js` is the only thing that talks to Firestore about bins,
`route.js` is pure route maths with no DOM in it at all, and `collector.js` is
the crew page that uses both.

### `server/`
Optional. A single Node file with no npm dependencies that serves the website
and adds a real backend: server-side sessions with an HttpOnly cookie and
authenticated REST endpoints. It exists to show the contrast with the
deliberately simple client-side login.

### `tests/`
`node tools/run-tests.js` runs all seven suites and prints one summary: **486
checks**. They cover the same logic the firmware implements - the fill
formula, the threshold bands, every transition of the lid state machine, the
full-bin lockdown and the command set - plus the fleet model, the Firestore
client, the route planner and the access rules. Automated tests in an embedded
student project are unusual and worth pointing at.

`tests/rules/` is separate on purpose. It tests `firestore.rules` against the
real Firebase emulator, which is a Java program, so it needs a Java runtime
and its own `npm install`. `tools/run-tests.js` therefore leaves it alone and
says so; run it with `cd tests/rules && npm test` for 99 more assertions.

### `tools/`
Small dependency-free Node scripts you run by hand. `run-tests.js` is the one
you use daily. `check-owners.js` is the one that saves an afternoon: an owner,
the crew and each device are defined in *two* files - `firebase-config.js` for
what the page offers and `firestore.rules` for what the database permits - and
nothing makes them agree automatically. When they drift, the symptom is a
person who gets the screen and is then refused on every write, which reads as
a bug rather than a missing edit.

### `data/`
Inputs and recorded outputs. `bins.json` is the seed fleet - 48 bins with real
coordinates, each with the fill it had at a fixed reference instant, from
which `data.js` computes the rest from the clock. `sample_serial_output.txt`
is a reference capture for your report; `test_results.csv` is the file you
fill in while testing.

### `firestore.rules`
At the repository root rather than in a folder, because that is where
`firebase.json` and the Firebase CLI expect it. It is the one file in this
project that enforces anything an attacker cannot edit: who may mark a bin
collected, who may override a lid, and which board may file readings for which
bin. Every other check decides what the interface offers.

### `outputs/`
Anything the system generates that is worth keeping: exported logs, captured
telemetry, charts made from the data.

### `screenshots/`
Every image referenced by the README and the report. Keep the names from
`docs/18-screenshot-checklist.md` so the links do not break.

### `reports/`
The formal write-up, the presentation, and the viva preparation notes.

### `docs/`
The nineteen numbered sections. Each one is self-contained so it can be read,
printed or submitted on its own.

---

## Naming conventions used throughout

| Kind | Convention | Example |
|---|---|---|
| Folders | lowercase with underscores | `arduino_code/` |
| Sketches | numbered prefix, matching folder | `04_smart_dustbin_complete.ino` |
| Docs | numbered, kebab-case | `12-bin-level-calculation.md` |
| C constants | UPPER_SNAKE_CASE | `HAND_DETECT_CM` |
| C functions | camelCase | `calculateFillPercent()` |
| C types | PascalCase | `LidState`, `BinStatus` |
| Screenshots | numbered, descriptive | `05-lid-open-state.png` |

The numbered prefixes exist so the files sort in the order you should read
them, both on GitHub and in a file browser.

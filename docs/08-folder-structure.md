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
│
├── simulation/              Run the project with no hardware
│   ├── wokwi/                    ESP32 simulation (primary)
│   │   ├── diagram.json          Complete wiring, import into wokwi.com
│   │   ├── sketch.ino            Copy of the ESP32 firmware
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
├── website/                 Public site + admin dashboard
│   ├── index.html                Public city status page
│   ├── login.html                Admin sign-in
│   ├── admin.html                Fleet dashboard with map and simulator
│   ├── README.md                 How to run and extend the site
│   └── assets/
│       ├── css/style.css
│       ├── js/data.js            Fleet data layer
│       ├── js/auth-config.js     Google Client ID (edit this)
│       ├── js/users.js           User registry: who may sign in, and as what
│       ├── js/auth.js            Session handling and the demo login
│       ├── js/oauth.js           Google ID token verification (WebCrypto)
│       ├── js/oauth-ui.js        Google Sign-In button wiring
│       ├── js/map.js             Leaflet map with an offline fallback
│       ├── js/sim.js             Firmware twin + animated dustbin
│       ├── js/public.js          Public page behaviour
│       ├── js/admin.js           Dashboard behaviour
│       └── img/circuit.svg
│
├── server/                  Optional Node backend (zero dependencies)
│   └── server.js                 Static hosting + session auth + REST API
│
├── tests/
│   ├── twin.test.js              64 automated checks of the firmware logic
│   ├── oauth.test.js             24 checks that forged JWTs are rejected
│   └── users.test.js             30 checks on access control
│
├── data/                    Datasets and recorded results
│   ├── bins.json                 Seed fleet of 16 bins
│   ├── sample_serial_output.txt  Reference Serial Monitor capture
│   ├── calibration_table.csv     Distance to percentage mapping
│   └── test_results.csv          Fill this in during Phase 11
│
├── outputs/                 Generated results worth keeping
├── screenshots/             Proof images for the report and README
├── reports/                 Project report and viva material
├── docs/                    This documentation set (19 sections)
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

### `simulation/`
Everything needed to run and demonstrate the project without owning any
hardware. `diagram.json` is the actual Wokwi wiring file - importing it
reproduces the whole circuit instantly.

### `circuit_diagram/`
The wiring reference. The SVG is vector, so it stays sharp when printed into a
report, and `connections.md` carries the tables, the assembly order, the power
budget and the fault table.

### `website/`
The public status page and the admin console. Static files only, so it works
by double-clicking `index.html`, and it deploys to GitHub Pages unchanged.

### `server/`
Optional. A single Node file with no npm dependencies that serves the website
and adds a real backend: server-side sessions with an HttpOnly cookie and
authenticated REST endpoints. It exists to show the contrast with the
deliberately simple client-side login.

### `tests/`
`node tests/twin.test.js` runs 64 assertions against the same logic the
firmware implements - the fill formula, the threshold bands, every transition
of the lid state machine, and the command set. Automated tests in an embedded
student project are unusual and worth pointing at.

### `data/`
Inputs and recorded outputs. `bins.json` seeds the fleet;
`sample_serial_output.txt` is a reference capture for your report;
`test_results.csv` is the file you fill in while testing.

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

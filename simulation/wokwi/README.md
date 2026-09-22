# Wokwi simulation - ESP32 (primary)

This is the main simulation for the project. It runs the real compiled ESP32
firmware, including Wi-Fi, on a simulated ESP32-WROOM-32.

An Arduino UNO variant is kept in [`uno/`](uno/) for anyone who needs it.

---

## Load it

1. Go to **wokwi.com** and click **New Project > ESP32**
2. Open the **diagram.json** tab, select all, and paste in
   [`diagram.json`](diagram.json)
3. Open the **sketch.ino** tab and paste in [`sketch.ino`](sketch.ino)
4. When the build complains about a missing library, click
   **Install "ESP32Servo" library**; do the same for **LiquidCrystal I2C**
   (or add both from the Library Manager tab up front)
5. Press the green play button

The whole circuit - 11 parts, 27 connections - appears fully wired.

Cloud sync is **off** unless you add a `secrets.h` tab - see
[Cloud sync in the simulator](#cloud-sync-in-the-simulator-optional) below.
It needs no extra library: `HTTPClient` and `WiFiClientSecure` ship with the
ESP32 core.

---

## Pin map (ESP32)

| Function | GPIO |
|---|---|
| Hand sensor TRIG / ECHO | 5 / 18 |
| Level A TRIG / ECHO (inside) | 19 / 23 |
| Level B TRIG / ECHO (inside) | 32 / 33 |
| Servo signal | 13 |
| Buzzer | 25 |
| Green LED | 26 |
| Red LED | 27 |
| LCD SDA / SCL | 21 / 22 |

> **Wokwi pin naming.** On `board-esp32-devkit-c-v4` the GPIOs are named
> `esp:5`, `esp:18`, `esp:19` and so on - **bare numbers, no `D` prefix**.
> `esp:D0`-`esp:D3`, `esp:CMD` and `esp:CLK` are the **flash** pins, not
> GPIO 0-3. Writing `esp:D5` gives you a silently dead wire, not an error.

---

## Wi-Fi in the simulator

The sketch ships with:

```c
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASS = "";
```

That is Wokwi's built-in network - it connects in about a second and gives the
simulated ESP32 real internet access. The serial monitor prints the IP address
it was assigned, and the built-in status page is served on it.

Change these two lines only when you flash real hardware, and blank them again
before committing to a public repository.

> **Why the sketch passes a channel number.** `Wokwi-GUEST` is always on
> **channel 6**, so the sketch calls `WiFi.begin(WIFI_SSID, WIFI_PASS, 6)`.
> Naming the channel skips the scan of all 13 channels, which costs about
> **4 seconds** of simulated boot time every single run. The sketch only does
> this when the SSID really is `Wokwi-GUEST`; for a real router it passes
> channel `0`, meaning "scan for it", because a real access point can move
> between channels.

---

## Cloud sync in the simulator (optional)

Without a `secrets.h` the sketch runs exactly as before and prints:

```
Cloud: sync OFF - add secrets.h next to the sketch (copy secrets.example.h) to report to the dashboards
```

Add the file and the simulated board signs in to Firebase and starts reporting
into `bins/BIN-001`, so the Wokwi run shows up live on the real dashboards.

1. In the Wokwi editor click the **+** beside the file tabs and choose
   **New file**. Name it exactly `secrets.h`.
2. Paste in [`secrets.example.h`](secrets.example.h) and replace the two
   placeholder values with the board account's real e-mail and password.
3. Press play. Watch for `Cloud: signed in - device UID ...` on the serial
   monitor, then `Cloud: first report written`.

The UID printed on that first line is what the owner puts into `deviceBins()`
in `firestore.rules` and `DEVICE_BINS` in `firebase-config.js`. Until it is
there and the rules are published, every write is refused and the board says:

```
Cloud: 403 - rules not published, or this device's UID is not in deviceBins()
```

Type `CLOUD` into the serial panel at any time for the full picture: signed in
or not, last push age, last HTTP code, last command id and free stack.

### Read this before you add secrets.h

- **A public Wokwi project shows every file tab to anybody who opens the
  link** - including `secrets.h`. Wokwi has no "secret file" feature. So
  either **make the project private** (Wokwi account menu > the project's
  visibility setting) before you add it, or accept the exposure knowingly.
- Accepting it is defensible *for this project only* because of how little
  the account can do: the Firestore rules let a device account write nothing
  but the `device` and `commandAck` fields of its own `bins/<DEVICE_ID>`
  document. The worst a leak buys an attacker is fake fill readings for one
  bin. It cannot read anybody's data, cannot touch another bin, and cannot
  create users. Reset the password in the Firebase console and the sketch is
  locked out again.
- Never reuse a password from anywhere else for this account, and never give
  the board a **person's** login. Give it its own account, as
  `secrets.example.h` explains.
- **Wokwi's internet access is a shared public gateway, and Wokwi monitors
  it.** Their guidance is not to send sensitive data through it, and heavy
  use may be rate-limited. Our traffic is one small HTTPS write every 5-60 s
  plus one read every 10 s, which is well-mannered; do not raise those rates
  just to make a demo look busier.
- `secrets.h` is in `.gitignore`. Keep it that way - never paste real
  credentials into a file inside this repository.

---

## Driving the simulation

Click any sensor while it runs and a distance control appears.

| To show | Set |
|---|---|
| Lid opening | Hand sensor to 10 cm |
| Lid closing | Hand sensor back to 80 cm, wait 3 s |
| Empty bin | Both level sensors to 30 cm |
| Half full | Both level sensors to 15 cm |
| Warning band | Both level sensors to 7.5 cm |
| Full + buzzer | Both level sensors to 3 cm |
| **Uneven load** | Level A to 3 cm, level B to 27 cm |
| Degraded mode | Delete one level sensor ECHO wire |
| **Full-bin lockdown** | Both level sensors to 3 cm, then hand sensor to 10 cm - the lid stays shut and the serial monitor prints `### Bin FULL - lid locked until it is emptied` once per approach |
| Crew override | While locked, type `OPEN` - the lid opens and the reply says `crew override` |
| Releasing the lock | Type `EMPTY`, or raise both level sensors back above 3 cm |

Type commands into the serial panel: `OPEN CLOSE AUTO MUTE UNMUTE EMPTY PING
STATUS WIFI CLOUD HELP`.

---

## Files

| File | Purpose |
|---|---|
| `diagram.json` | The circuit - paste into the diagram.json tab |
| `sketch.ino` | Byte-for-byte copy of `arduino_code/05_esp32_wifi_version` |
| `secrets.example.h` | Template for the optional `secrets.h` tab (cloud sync) |
| `libraries.txt` | Libraries Wokwi should install |
| `wokwi.toml` | Only needed for the VS Code extension |
| `uno/` | The Arduino UNO variant |

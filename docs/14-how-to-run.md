# 14. How to Run the Project

Three ways to run it. Pick whichever matches what you have.

---

# A. Real hardware - ESP32 (primary)

### 1. Install the Arduino IDE
Download the IDE 2.x from arduino.cc and install it.

### 2. Add the ESP32 board package
`File > Preferences > Additional Board Manager URLs`, paste:

```
https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
```

Then `Tools > Board > Boards Manager`, search **esp32**, and install
**esp32 by Espressif Systems**.

### 3. Install the libraries
`Sketch > Include Library > Manage Libraries`, then install:
- **ESP32Servo** (by Kevin Harrington) - *not* the plain `Servo` library
- **LiquidCrystal I2C** (by Frank de Brabander) - only if you have an LCD

> The IDE warns that LiquidCrystal I2C "claims to run on avr architecture".
> That is a metadata quirk in the library; it uses only `Wire` and works fine
> on the ESP32. The warning is expected and harmless.

### 4. Select the board
`Tools > Board > ESP32 Arduino > **ESP32 Dev Module**`.

### 5. Select the port
`Tools > Port` and pick the COM port that appears when you plug the board in.
If nothing appears, the cable is charge-only - try a different one before
installing any drivers. Some ESP32 boards also need the CP210x or CH340 USB
driver.

### 6. Set your Wi-Fi credentials
At the top of the sketch:

```c
const char* WIFI_SSID = "your-network";
const char* WIFI_PASS = "your-password";
```

Leave them as `Wokwi-GUEST` / empty for the simulator. **Blank them again
before committing to a public repository.**

### 7. Open and upload the sketch
`File > Open` then
`arduino_code/05_esp32_wifi_version/05_esp32_wifi_version.ino`.
Press the arrow. If the upload stalls at "Connecting...", hold the **BOOT**
button on the ESP32 until it starts.

### 8. Open the Serial Monitor
`Tools > Serial Monitor`, baud rate **115200**, line ending **Newline**.

### 9. Test it
1. Wave a hand in front of sensor 1 - the lid should open.
2. Move something towards the two level sensors - the fill should rise.
3. Type `HELP`, then `WIFI` to see the assigned IP address.
4. Open that IP in a browser for the bin's built-in status page.

---

# A2. Real hardware - Arduino UNO (alternative)

Install the **Servo** and **LiquidCrystal I2C** libraries, select
`Arduino AVR Boards > Arduino Uno`, open
`arduino_code/04_smart_dustbin_complete/`, upload, and open the Serial Monitor
at **9600 baud**. Everything works identically apart from the networking.

---

# B. Virtual simulation

Full step-by-step instructions are in `docs/11-virtual-simulation.md`. The
short version:

**Wokwi**
1. wokwi.com > New Project > **ESP32**.
2. Paste `simulation/wokwi/diagram.json` into the diagram.json tab.
3. Paste `simulation/wokwi/sketch.ino` into the sketch tab.
4. Install **ESP32Servo** and **LiquidCrystal I2C** when prompted.
5. Press play, then click a sensor to change its distance.

**Tinkercad**
See `simulation/tinkercad/README.md`.

---

# C. The website and admin dashboard

### Option 1 - just open the files

Double-click `website/index.html`. Everything works, including the map, the
simulator and the login.

### Option 2 - run the local server (recommended)

```bash
node server/server.js
```

Then open <http://localhost:3000>. This adds a real backend with server-side
sessions and authenticated API endpoints. No `npm install` is needed - the
server has zero dependencies.

### Signing in

| | |
|---|---|
| Username | `Nischay` |
| Password | `Admin@123` |

---

# Expected output

### Serial Monitor at boot

```
==================================================
   SMART DUSTBIN - EMBEDDED SYSTEM (ESP32)
   Device  : BIN-001
   Firmware: v1.0.0
   Sensors : 1 hand + 2 in-bin level (A and B)
   Bin height     : 30.0 cm
   Hand threshold : 25.0 cm
   Warn / Full    : 75 % / 90 %
   Uneven-load gap: 25 %
==================================================
Power-on self test ... outputs OK
Sensor check: HAND OK | LEVEL-A OK | LEVEL-B OK
Connecting to Wi-Fi...
Connected. Dashboard URL: http://10.13.37.2
Status endpoint:          http://10.13.37.2/api/status
HTTP server started on port 80
System running. Type HELP for commands.
```

### Normal running

```
[12s] Hand=---cm | Lid=CLOSED | A=0% B=0% | Fill=0% | Status=OK | Opens=0
        [--------------------] 0%
{"id":"BIN-001","fill":0,"fillA":0,"fillB":0,"spread":0,"uneven":false,"sensors":2,"lid":"CLOSED","status":"OK","opens":0,"errors":0,"uptime":12}
```

### A hand arriving

```
>>> Hand detected - opening lid
[14s] Hand=10.2cm | Lid=OPENING | A=0% B=0% | Fill=0% | Status=OK | Opens=1
```

### The hand leaving

```
<<< Area clear - closing lid
[20s] Hand=---cm | Lid=CLOSED | A=0% B=0% | Fill=0% | Status=OK | Opens=1
```

### The bin reaching the warning band

```
[38s] Hand=---cm | Lid=CLOSED | A=78% B=72% | Fill=75% | Status=WARNING | Opens=1
        [###############-----] 75%
```

### The full-bin alert

```
[46s] Hand=---cm | Lid=CLOSED | A=92% B=88% | Fill=90% | Status=FULL | Opens=1
        [##################--] 90%
```

At this point the green LED goes out, the red LED is solid, and the buzzer
chirps for 200 ms about every two seconds.

A complete captured session is in `data/sample_serial_output.txt`.

### An uneven load

```
[52s] Hand=---cm | Lid=CLOSED | A=90% B=10% | Fill=50% | Status=OK | Opens=1 | UNEVEN LOAD
```

Rubbish piled under sensor A. The fused reading is 50 %, and the flag tells
staff the load needs levelling. A single-sensor bin would have reported 90 %
and sent a van.

### A failed level sensor

```
[60s] Hand=---cm | Lid=CLOSED | A=--% B=88% | Fill=88% | Status=WARNING | Opens=1 | DEGRADED 1 SENSOR
```

Sensor A has stopped answering. The bin keeps measuring on B alone and says
so, instead of going blind.

### Expected lid behaviour

| Situation | Lid |
|---|---|
| Nothing within 25 cm | Closed |
| Hand at 24 cm or less | Opens within about 100 ms |
| Hand still present | Stays open |
| Hand leaves | Closes 3 s later |
| Hand returns mid-close | Re-opens immediately |
| `OPEN` command sent | Forced open until `AUTO` |

---

# Serial commands

Type these into the Serial Monitor (115200 baud on ESP32, 9600 on UNO) with the line ending set to Newline:

| Command | Effect |
|---|---|
| `OPEN` | Force the lid open, enter manual override |
| `CLOSE` | Force the lid shut, enter manual override |
| `AUTO` | Leave manual override, resume automatic control |
| `MUTE` | Silence the buzzer |
| `UNMUTE` | Re-enable the buzzer |
| `EMPTY` | Mark the bin collected, reset the counters |
| `STATUS` | Print a full report immediately |
| `HELP` | List the commands |
| `WIFI` | Print the SSID, connection state, IP address and signal strength |

---

# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Port not listed | Charge-only USB cable | Use a data cable |
| `programmer is not responding` | Wrong board or port, or the port is held open | Re-select, close other serial windows |
| Garbled serial output | Baud rate mismatch | ESP32 uses **115200**, UNO uses 9600 |
| Distance always 0 | TRIG and ECHO swapped | D2/D4/D8 are TRIG, D3/D5/D9 are ECHO |
| `UNEVEN LOAD` on an empty bin | A and B not mounted level with each other | Shim them to the same height, then recalibrate |
| A and B glitch together | The two level sensors are hearing each other | Increase `SENSOR_SETTLE_MS` above 12 ms |
| Board resets when the servo moves | USB cannot supply the current | External 5 V / 2 A supply, grounds joined, 470 µF cap |
| Upload stalls at "Connecting..." | ESP32 not in bootloader mode | Hold the BOOT button until the upload starts |
| ESP32 dies after a few weeks | 5 V ECHO into a 3.3 V pin | Fit the 1 kΩ / 2 kΩ dividers on all three ECHO lines |
| `Servo.h` compile error on ESP32 | Wrong library | Install and use **ESP32Servo** |
| LCD blank but backlit | Wrong I2C address | Change `0x27` to `0x3F` |
| Fill percentage always wrong | `BIN_HEIGHT_CM` not calibrated | Measure the empty bin, use that number |
| Commands ignored | Line ending set to "No line ending" | Set it to Newline |
| Website map is blank | No internet for the map tiles | It falls back to an offline grid map automatically |
| Dashboard cannot reach the ESP32 | Missing CORS header, or the wrong IP | Use sketch 05 as-is, and check the IP it printed |

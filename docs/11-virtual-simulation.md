# 11. Virtual Simulation

You do not need any hardware to build, run, demonstrate or submit this
project. There are three independent ways to simulate it, and you should use
at least two so a failure in one does not sink your demo.

| Tool | Best for | Realism | Setup time |
|---|---|---|---|
| **Wokwi** | The main demo. Runs the real compiled firmware | Very high | 5 minutes |
| **Tinkercad Circuits** | A backup, and labs that mandate it | Medium | 15 minutes |
| **Browser twin** (in this repo) | Instant, offline, no account needed | Logic-accurate | 0 minutes |

---

# Part 1 - Wokwi (recommended)

Wokwi runs the actual AVR machine code your sketch compiles to, on a simulated
ATmega328P, with simulated HC-SR04s, servo, LEDs and LCD. What you see is what
the hardware does.

## The two-minute route

1. Go to **wokwi.com** and sign in (a free account lets you save projects).
2. Click **New Project > ESP32**.
3. Click the **diagram.json** tab.
4. Open `simulation/wokwi/diagram.json` from this repository, copy all of it,
   and paste it over what is there. The whole circuit appears, fully wired.
5. Click the **sketch.ino** tab and paste in `simulation/wokwi/sketch.ino`.
6. When the build reports a missing library, click **Install "ESP32Servo"
   library**, and do the same for **LiquidCrystal I2C**.
7. Press the green **play** button.

Wi-Fi works in the simulator: the sketch uses `Wokwi-GUEST`, connects in about
a second, and prints the IP address it was given. Open that address and you
get the bin's built-in status page.

> An Arduino UNO variant of the whole simulation is kept in
> `simulation/wokwi/uno/` if you need it.

### Optional - put the simulated bin on the live dashboard

The sketch can report into Firestore, and a Wokwi board can do it just as well
as a real one. Add a new file tab called `secrets.h`, paste
`simulation/wokwi/secrets.example.h` into it, and fill in the device account
you created in Firebase. The serial panel then prints `Cloud: sync ON -
reporting to Firestore bins/BIN-001`, and that bin turns into a **device** bin
on the public map, with the numbers coming from the simulation rather than
from the model.

> **Keep that Wokwi project private.** A public project shows every tab to
> anyone who opens it, including `secrets.h`. If you want to share a link,
> share one from a project with no `secrets.h` tab - everything else works
> exactly the same, the board just does not report to the cloud.

Wokwi's own guidance is not to push sensitive data through the public gateway,
and it may rate-limit heavy use, so this is a demonstration rather than
something to leave running for days.

That is it. Skip to "Driving the simulation" below.

## The long route - build it component by component

Do this once if you want to be able to explain the wiring in a viva.

**Step 1 - Create the project.**
wokwi.com > New Project > ESP32. You get a bare ESP32 DevKit and an empty sketch.

**Step 2 - Add the first ultrasonic sensor.**
Click the blue **+** button, search "Ultrasonic Distance Sensor", pick HC-SR04.
Wire it: VCC to 5V, GND to GND, **TRIG to GPIO5**, **ECHO to GPIO18**.

**Step 3 - Add the servo.**
**+** then "Servo". Wire V+ to 5V, GND to GND, **PWM to GPIO13**.

**Step 4 - Add level sensor A (inside the bin).**
**+** then HC-SR04 again. VCC to 5V, GND to GND, **TRIG to GPIO19**, **ECHO to GPIO23**.

**Step 5 - Add level sensor B (inside the bin).**
**+** then HC-SR04 a third time. VCC to 5V, GND to GND, **TRIG to GPIO32**,
**ECHO to GPIO33**. On the real bin this one goes on the opposite diagonal to A.

**Step 6 - Add the LEDs and the buzzer.**
- **+** then LED, colour green. Anode to **GPIO26**, cathode through a resistor to GND.
- **+** then Resistor, set the value to **220**.
- Repeat with a red LED on **GPIO27** and a second 220 ohm resistor.
- **+** then Buzzer. Pin 1 to **GPIO25**, pin 2 to GND.

**Step 7 - Add the LCD (optional).**
**+** then "LCD 16x2 (I2C)". Wire GND to GND, VCC to 5V, **SDA to GPIO21**, **SCL to GPIO22**.
If you skip this, comment out `#define USE_LCD` at the top of the sketch.

**Step 8 - Paste the code.**
Copy `arduino_code/05_esp32_wifi_version/05_esp32_wifi_version.ino` into the
sketch tab, then add the two libraries.

> **Watch the pin names.** On Wokwi's `board-esp32-devkit-c-v4` the GPIOs are
> `esp:5`, `esp:18`, `esp:19` and so on - **bare numbers, no `D` prefix**. The
> pins named `esp:D0` to `esp:D3`, `esp:CMD` and `esp:CLK` are the *flash*
> pins. Writing `esp:D5` produces a silently dead wire, not an error message.

**Step 9 - Run.**
Press play. The serial panel shows the boot banner, the self test runs (both
LEDs blink, the buzzer chirps, the servo sweeps), then telemetry starts.

## Driving the simulation

**To simulate a hand approaching**

1. Click the **first** HC-SR04 (the one on GPIO5/18) while the simulation runs.
2. A small distance control appears - drag it, or type a value.
3. Set it to **10 cm**.
4. The servo rotates to 90 degrees and the serial panel prints
   `>>> Hand detected - opening lid`.
5. Set it back to **80 cm**. Three seconds later the lid closes.

**To simulate the bin filling up**

Set **both** level sensors (GPIO19/23 and GPIO32/33) to the same distance -
that represents a flat load:

| Set A and B to | Fill shown | What should happen |
|---|---|---|
| 30 cm | 0 % | Green LED on, no alerts |
| 22.5 cm | 25 % | Green LED on |
| 15 cm | 50 % | Green LED on |
| 7.5 cm | 75 % | Green stays on, **red starts blinking**. The lid still opens |
| 3 cm | 90 % | Green off, **red solid, buzzer chirps**, telemetry gains ` \| LOCKED` - **and the lid stops opening for a hand** |
| 0 cm | 100 % | Same as 90 %, fill reads 100 |

**To show the full-bin lockdown - the other demonstration worth showing**

1. Set **both** level sensors to **3 cm**. The bin reports `Status=FULL`, the
   red LED goes solid, and the telemetry line gains ` | LOCKED`.
2. Now bring the **hand** sensor to 10 cm, as if somebody were about to drop a
   bag in.
3. The servo does not move. The serial panel prints, **once**:

```
### Bin FULL - lid locked until it is emptied
[54s] Hand=10.2cm | Lid=CLOSED | A=90% B=90% | Fill=90% | Status=FULL | Opens=3 | LOCKED
{"id":"BIN-001",...,"status":"FULL","locked":true,"refused":1,...}
```

4. Leave the hand there. `refused` **stays at 1** - the refusal is latched
   until the hand goes away, or the hand sensor's 60 ms poll would count
   sixteen refusals a second and flood the panel.
5. Type `OPEN` and press Enter. The lid opens anyway, and the reply names the
   override: `lid forced open (crew override - bin FULL)`. That is how the
   crew get in to empty it. Type `AUTO`, let the lid close, present the hand
   again, and it is refused once more.
6. Type `EMPTY`, or just raise both level sensors above 3 cm. The lock is
   released either way, and `EMPTY` also resets `refused` to 0.

Say out loud why the lock exists: a bin that keeps accepting bags after it has
reported FULL is how rubbish ends up on the pavement around it.

**To show that safety still beats the lockdown**

Start with an empty bin. Wave the hand sensor so the lid opens, take it away,
and while the lid is **closing** drop both level sensors to 3 cm and put the
hand back. The lid re-opens - `!!! Hand returned - re-opening` - even though
the bin is now full. A lid must never close on somebody's hand, so there is
deliberately no lock test in the closing branch.

**To simulate an uneven load - the demonstration worth showing**

Set sensor **A to 3 cm** and sensor **B to 27 cm**. That is a bag piled up
under A and a hollow under B.

```
[46s] Hand=---cm | Lid=CLOSED | A=90% B=10% | Fill=50% | Status=OK | Opens=1 | UNEVEN LOAD
```

The fused reading is 50 %, not 90 %. Say out loud what that means: a bin with
a single sensor mounted where A is would have declared itself full and sent a
collection van to a half-empty bin.

**To simulate a failed sensor**

Set sensor A to **0 cm** and then delete its ECHO wire (click the wire, press
Delete). The telemetry should show `A=--%`, `sensors=1` and
`DEGRADED 1 SENSOR`, and the bin should keep working from B alone rather than
going dark.

**To send a command**

Click into the serial panel, type `STATUS` and press Enter. Also try `MUTE`,
`EMPTY` and `HELP`.

## What the Serial Monitor should show

At boot:
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
Cloud: sync OFF - add secrets.h next to the sketch (copy secrets.example.h) to report to the dashboards
System running. Type HELP for commands.
```

That last `Cloud:` line is what you see without a `secrets.h` tab. With one it
reads `Cloud: sync ON - reporting to Firestore bins/BIN-001` instead, and
typing `CLOUD` at any point prints whether the board is signed in, how long
ago it last pushed, the last HTTP code and the last command id it saw.

While running:
```
[12s] Hand=---cm | Lid=CLOSED | A=0% B=0% | Fill=0% | Status=OK | Opens=0
        [--------------------] 0%
{"id":"BIN-001","fill":0,...,"lid":"CLOSED","status":"OK","locked":false,"opens":0,"refused":0,"errors":0,...}
```

With a hand present and the bin in the warning band - the lid still opens:
```
>>> Hand detected - opening lid
[46s] Hand=10.2cm | Lid=OPEN | A=82% B=78% | Fill=80% | Status=WARNING | Opens=3
        [################----] 80%
```

With a hand present and the bin **full** - the lid does not:
```
### Bin FULL - lid locked until it is emptied
[54s] Hand=10.2cm | Lid=CLOSED | A=90% B=90% | Fill=90% | Status=FULL | Opens=3 | LOCKED
        [##################--] 90%
```

## Sharing your Wokwi project

1. Click **Save** and name it "Smart Dustbin - Embedded System".
2. Click **Share** and copy the public link.
3. The URL looks like `https://wokwi.com/projects/123456789012345678`.
4. Put that link near the top of your README, and paste the numeric ID into
   the **Wokwi project ID** box on the admin dashboard - the simulation then
   embeds directly inside your own website.

---

# Part 2 - Tinkercad Circuits

**Tinkercad has no ESP32 and no I2C LCD**, so this route is Arduino UNO only,
using `simulation/tinkercad/tinkercad_sketch.ino` - the same firmware with the
display removed and the UNO pin map. Use Wokwi for the ESP32 build. Full instructions are in
`simulation/tinkercad/README.md`. The short version:

1. tinkercad.com > Circuits > Create new Circuit.
2. Drag in an **Arduino Uno R3**.
3. Drag in two **Ultrasonic Distance Sensors** and set both to 4-pin mode.
4. Drag in a **Micro Servo**, two LEDs, two 220 ohm resistors and a **Piezo**.
5. Wire everything to the pin map in `docs/09-circuit-diagram.md`.
6. Click **Code**, switch the dropdown to **Text**, and paste the sketch.
7. Click **Start Simulation**, then click a sensor to drag its distance slider.

---

# Part 3 - The browser twin in this repository

Both the public page and the admin dashboard carry a JavaScript port of the
same state machine, so you can demonstrate the logic with no internet, no
hardware and no account at all.

1. Open `website/index.html`, or run `node server/server.js`. **No sign-in
   is needed** - the simulator is on the public page, which is what makes it
   the safest thing to show when the network is unreliable.
2. Scroll to **Try the firmware yourself**.
3. Drag the **hand** slider under 25 cm - the lid on the animated bin lifts.
4. Drag the **sensor A** and **sensor B** sliders, or click the 25 / 50 / 75 /
   90 % buttons, which set both at once.
5. Press **Uneven pile (A 90 / B 10)** and **Unplug sensor A** to see the
   fusion and the degraded mode in action.
6. Press **90%** or **Full**, then drag the hand slider under 25 cm. A white
   padlock appears on the bin, the words **LOCKED - FULL** sit above it, the
   lid stays shut, and the **Turned away** readout counts up by one. Type
   `OPEN` into the console and it opens anyway, with the reply naming the
   crew override.
7. Watch the LEDs, the buzzer indicator and the serial console react.
8. Type commands into the console input exactly as you would on the device.

Because it is the same logic with the same constants, its output matches the
Wokwi run line for line. `node tests/twin.test.js` asserts exactly that, with
**88 checks**.

The twin is in fact the *reference*: the lockdown was written here first and
the four firmware builds were made to match it, which is why the tests can be
trusted to catch a drift in either direction.

---

## Screenshots to capture from the simulation

These are the images that make the project credible. Save them into
`screenshots/` under these names:

| # | File name | What to capture |
|---|---|---|
| 1 | `03-wokwi-full-circuit.png` | The complete wired circuit, simulation stopped |
| 2 | `04-lid-closed-state.png` | Running, hand sensor at 80 cm, lid closed, green LED on |
| 3 | `05-object-detected.png` | Hand sensor at 10 cm, the detection line visible in the log |
| 4 | `06-lid-open-state.png` | Servo at 90 degrees, lid visibly open |
| 5 | `07-empty-bin-reading.png` | Level sensor at 30 cm, serial showing `Fill=0%` |
| 6 | `08-half-full-reading.png` | Level sensor at 15 cm, `Fill=50%` |
| 7 | `09-warning-75.png` | 7.5 cm on both, `Status=WARNING`, red LED blinking |
| 8 | `10-full-bin-alert.png` | 3 cm, `Status=FULL`, red solid, buzzer active |
| 9 | `11-serial-monitor.png` | A long serial capture including the boot banner |
| 10 | `12-lcd-display.png` | The LCD showing `Fill: 90% FULL` |
| 11 | `13-serial-commands.png` | The result of typing `HELP` and `STATUS` |
| 12 | `14-uneven-load.png` | A at 3 cm, B at 27 cm, `UNEVEN LOAD` in the serial log |
| 13 | `15-degraded-sensor.png` | One ECHO wire removed, `sensors=1`, `DEGRADED 1 SENSOR` |
| 14 | `24-full-bin-locked.png` | Both level sensors at 3 cm and the hand sensor at 10 cm: the lid shut, `### Bin FULL - lid locked until it is emptied` and ` \| LOCKED` in the log |
| 15 | `25-crew-override.png` | The same bin after typing `OPEN`: the lid open and the reply naming the crew override |

## What simulation proof to upload to GitHub

1. **`simulation/wokwi/diagram.json`** - the actual circuit file. A reviewer
   can reproduce your build in thirty seconds, which is far stronger evidence
   than any screenshot.
2. **The Wokwi share link**, near the top of the README.
3. **The screenshots above**, in `screenshots/`, referenced from the README.
4. **`data/sample_serial_output.txt`** - a full captured serial session.
5. **`data/test_results.csv`** - the completed test table.
6. A short **screen recording** under 10 MB, or a YouTube link if it is larger.

A runnable circuit file plus a live link plus recorded output is what separates
a project that looks finished from one that actually is.

---

## Troubleshooting the simulation

| Problem | Cause | Fix |
|---|---|---|
| `LiquidCrystal_I2C.h: No such file` | Library not added in Wokwi | Library Manager tab, add "LiquidCrystal I2C" |
| `ESP32Servo.h: No such file` | Library not added | Click "Install ESP32Servo library" on the error |
| A wire looks connected but does nothing | Pin written as `esp:D5` | It must be `esp:5` - no `D` prefix |
| Wi-Fi never connects | SSID changed from the default | It must be exactly `Wokwi-GUEST` with an empty password |
| The servo never moves | Wrong library or pin | ESP32 needs **ESP32Servo**, not `Servo.h`; signal on GPIO13 |
| Distance always reads 0 | TRIG and ECHO swapped | GPIO5 is TRIG, GPIO18 is ECHO |
| Serial output is garbled | Baud rate mismatch | ESP32 uses **115200**, the UNO uses 9600 |
| The LCD shows black boxes | Wrong I2C address | Change `0x27` to `0x3F` |
| Everything is very slow | Browser tab throttled in the background | Keep the Wokwi tab in the foreground |
| Fill stays at 0 % no matter what | You are moving the hand sensor | The level sensors are on GPIO19/23 and GPIO32/33 |
| Fill only moves half as much as expected | You changed only one level sensor | The reading is the average of A and B - move both |
| `UNEVEN LOAD` shows on an empty bin | A and B set to different distances | Set both to the same value for a flat load |

# 10. Source Code Guide

Where every piece of code lives, and what the important functions do.

| Path | Purpose |
|---|---|
| `arduino_code/01_lid_module/` | **Module A** - touchless lid only |
| `arduino_code/02_bin_level_module/` | **Module B** - fill percentage only |
| `arduino_code/03_alert_module/` | **Module C** - LEDs and buzzer only |
| `arduino_code/05_esp32_wifi_version/` | **PRIMARY** - the complete system on ESP32, with Wi-Fi |
| `arduino_code/04_smart_dustbin_complete/` | The same system on an Arduino UNO, no networking |
| `src/` | The same firmware split into proper modules |
| `website/assets/js/sim.js` | The JavaScript twin of the firmware |
| `tests/twin.test.js` | 40 automated assertions |

Build modules A, B and C first. Each is small enough to debug on its own, and
together they contain every idea that module D combines.

---

## A. Automatic lid module

**File:** `arduino_code/01_lid_module/01_lid_module.ino`

Contains one ultrasonic sensor, one servo, a detection threshold and a hold
timer.

### `readDistanceCm(trigPin, echoPin)`

```c
digitalWrite(trigPin, HIGH);
delayMicroseconds(10);          // the datasheet requires a 10 us pulse
digitalWrite(trigPin, LOW);

unsigned long duration = pulseIn(echoPin, HIGH, 25000UL);
if (duration == 0) return -1.0; // timeout, nothing in range

float cm = duration / 58.31;    // us -> cm, halved for the round trip
```

It returns `-1.0` rather than `0` for a failure, because `0` is a *plausible*
distance and would be silently misread as "something is touching the sensor".
A sentinel that cannot occur naturally is the safer choice.

### The hold timer

```c
if (handDetected) lastSeenHandAt = now;

if (lidOpen && (now - lastSeenHandAt >= LID_OPEN_HOLD_MS)) {
    lidServo.write(ANGLE_CLOSED);
    lidOpen = false;
}
```

The timestamp is refreshed on **every** detection, so the countdown always
means "three seconds since I last saw anybody" rather than "three seconds
since the lid opened". That is what stops the lid closing on somebody who is
still standing there.

---

## B. Bin level module

**File:** `arduino_code/02_bin_level_module/02_bin_level_module.ino`

### `calculateFillPercent(measuredDistanceCm)`

```c
if (measuredDistanceCm > BIN_HEIGHT_CM) measuredDistanceCm = BIN_HEIGHT_CM;
if (measuredDistanceCm < 0)             measuredDistanceCm = 0;

float fillLevel = BIN_HEIGHT_CM - measuredDistanceCm;
float pct       = (fillLevel / BIN_HEIGHT_CM) * 100.0;
```

Pure arithmetic, no hardware touched, which is exactly why it is easy to test:
feed it 15 and expect 50. Two input clamps and two output clamps handle
readings that fall outside the physical bin.

### `readDistanceMedian(trigPin, echoPin)`

Three pings 12 ms apart, and the middle value wins:

```c
float hi = (a > b) ? a : b;
float lo = (a > b) ? b : a;
if (c >= hi) return hi;
if (c <= lo) return lo;
return c;
```

No sorting, no array, three comparisons. A median rejects an outlier outright,
whereas an average lets one wild spike drag the result.

### `printBar(percent)`

Draws a 20-character text gauge. It exists purely so your Serial Monitor
screenshot is readable at a glance in a report.

---

## C. Alert module

**File:** `arduino_code/03_alert_module/03_alert_module.ino`

### `updateAlerts(fillPercent, now)`

Applies the policy table: green below 75 %, red blinking to 89 %, red solid
plus a chirp from 90 %.

### The non-blocking beep

```c
if (buzzerOn && (now - buzzerChanged >= BEEP_ON_MS)) {
    buzzerOn = false; digitalWrite(PIN_BUZZER, LOW);  buzzerChanged = now;
} else if (!buzzerOn && (now - buzzerChanged >= BEEP_OFF_MS)) {
    buzzerOn = true;  digitalWrite(PIN_BUZZER, HIGH); buzzerChanged = now;
}
```

Two branches and one timestamp produce a 200 ms-on, 1.8 s-off pattern without
ever blocking. The naive `digitalWrite(HIGH); delay(200); digitalWrite(LOW);`
freezes everything else for a fifth of a second, every two seconds.

### `selfTest()`

Blinks each LED, chirps the buzzer and sweeps the servo once at power-on, so
an installer can confirm the wiring from across the room without a laptop.
Real products do this.

---

## D. Complete integrated firmware

**File:** `arduino_code/04_smart_dustbin_complete/04_smart_dustbin_complete.ino`

### `loop()` - the cooperative scheduler

```c
void loop() {
  unsigned long now = millis();

  handleSerialCommands();

  if (now - tLid   >= LID_SAMPLE_MS)   { tLid   = now; taskHandDetection(now); }
  if (now - tLevel >= LEVEL_SAMPLE_MS) { tLevel = now; taskBinLevel();         }
  if (now - tTelem >= TELEMETRY_MS)    { tTelem = now; taskTelemetry(now);     }

  taskAlerts(now);
  taskDisplay();
}
```

Four tasks at three different rates on one core, with no RTOS. `millis()` is
read **once** per pass so every task in that pass agrees on what time it is -
calling `millis()` separately inside each task lets them disagree by a few
microseconds, which is a genuinely annoying class of bug.

### `updateLidStateMachine(handDetected, now)`

The four-state machine. The transition worth pointing at in a viva is inside
`LID_CLOSING`:

```c
case LID_CLOSING:
  if (handDetected) {              // safety re-open
    lidServo.write(ANGLE_OPEN);
    enterLidState(LID_OPENING, now);
  } else if (now - stateEnteredAt >= LID_TRAVEL_MS) {
    enterLidState(LID_CLOSED, now);
  }
  break;
```

Somebody puts their hand back while the lid is coming down. In a boolean
implementation that case is undefined; here it is one readable branch.

### `taskBinLevel()`

```c
if (lidIsOpen()) return;
```

One line, and it is the difference between a fill percentage you can trust and
one you cannot. With the lid raised the sensor points at the ceiling.

### `taskTelemetry(now)`

Emits two lines: a human-readable one for the Serial Monitor and a JSON one
for machines. Both, every time - deriving one from the other later is more
fragile than simply printing both.

### `handleSerialCommands()`

Parses `OPEN`, `CLOSE`, `AUTO`, `MUTE`, `UNMUTE`, `EMPTY`, `STATUS` and `HELP`.
This is the seam that makes the bin remotely controllable: the ESP32 version
triggers exactly the same actions from an HTTP request instead of from UART.

`manualOverride` is what stops the automatic logic fighting the operator -
once you force the lid open it stays open until `AUTO` is sent.

---

## The modular version in `src/`

Same behaviour, organised the way production firmware is:

| File | Responsibility |
|---|---|
| `config.h` | Every pin, threshold and timing constant |
| `ultrasonic.h/.cpp` | HC-SR04 driver, median filtering, validity checks |
| `lid.h/.cpp` | The servo state machine |
| `bin_level.h/.cpp` | Fill maths and status classification |
| `alert.h/.cpp` | LED and buzzer policy |
| `display.h/.cpp` | Optional LCD, compiled out when `USE_LCD` is undefined |
| `main.cpp` | Scheduler and task functions |

Two patterns here are worth being able to explain.

**The sensor struct.** `Ultrasonic` holds the pins and the last good reading,
so one driver serves both sensors with no duplicated code:

```c
Ultrasonic lidSensor, levelSensor;
ultrasonicInit(&lidSensor,   PIN_TRIG_LID,   PIN_ECHO_LID);
ultrasonicInit(&levelSensor, PIN_TRIG_LEVEL, PIN_ECHO_LEVEL);
```

**Feature flags.** `#ifdef USE_LCD` means the display code compiles to nothing
when the feature is off, so the build works unchanged for students without a
screen. That is how real products ship several hardware variants from one
source tree.

---

## E. ESP32 version - the primary build

**File:** `arduino_code/05_esp32_wifi_version/05_esp32_wifi_version.ino`

This is the main firmware. Identical sensing, fusion and lid logic to module
D, plus a `WebServer` on port 80:

| Endpoint | Returns |
|---|---|
| `GET /` | A small built-in status page |
| `GET /api/status` | Live JSON telemetry |
| `GET /api/command?cmd=OPEN` | Applies a command and acknowledges it |

### Three ESP32-specific details worth knowing

**1. `ESP32Servo`, not `Servo.h`.** The AVR library pokes Timer1 directly. The
ESP32 generates PWM with its LEDC peripheral, so it needs its own library and
an explicit pulse range:

```c
lidServo.setPeriodHertz(50);            /* standard 50 Hz servo   */
lidServo.attach(PIN_SERVO, 500, 2400);  /* min and max pulse, us  */
```

**2. `Wire.begin(21, 22)`.** On the UNO the I2C pins are hard-wired inside the
chip. The ESP32 can route I2C almost anywhere, so the pins are named
explicitly - staying on the default pair keeps every online example valid.

**3. One command implementation, two front doors.** `applyCommand()` is called
both by `handleCommand()` (HTTP) and by `handleSerialCommands()` (UART). The
behaviour cannot drift between the two because there is only one copy of it.

The one line that makes the dashboard work:

```c
server.sendHeader("Access-Control-Allow-Origin", "*");
```

Without that CORS header the browser fetches the data and then refuses to let
the page read it, which looks exactly like a network failure and is not.

---

## The JavaScript twin

**File:** `website/assets/js/sim.js`

A direct port of the same state machine, used by the dashboard so the logic
can be demonstrated with no hardware and no internet. It mirrors the firmware
down to the 1 Hz level-sampling rate, so counters advance at the same speed in
both.

**If you change a threshold in the `.ino`, change it here too.** The tests
exist to catch you when you forget:

```bash
node tests/twin.test.js
```

---

## Coding conventions used throughout

| Convention | Example | Reason |
|---|---|---|
| Constants in UPPER_SNAKE | `HAND_DETECT_CM` | Instantly distinguishable from variables |
| Functions in camelCase | `calculateFillPercent()` | Arduino community standard |
| Types in PascalCase | `LidState`, `BinStatus` | Distinguishes a type from a value |
| `F()` around string literals | `Serial.println(F("..."))` | Keeps the string in flash, saving scarce SRAM |
| Explicit prototypes | at the top of the sketch | Removes any dependency on the IDE prototype generator |
| One concern per function | `taskAlerts()` only drives outputs | Each piece can be read and tested alone |
| Sentinels, not zero | `INVALID = -1.0` | Zero is a legal distance; -1 cannot happen naturally |

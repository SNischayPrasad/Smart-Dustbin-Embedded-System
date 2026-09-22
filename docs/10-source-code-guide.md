# 10. Source Code Guide

Where every piece of code lives, and what the important functions do.

| Path | Purpose |
|---|---|
| `arduino_code/01_lid_module/` | **Module A** - touchless lid only |
| `arduino_code/02_bin_level_module/` | **Module B** - fill percentage only |
| `arduino_code/03_alert_module/` | **Module C** - LEDs and buzzer only |
| `arduino_code/05_esp32_wifi_version/` | **PRIMARY** - the complete system on ESP32, with Wi-Fi and optional cloud sync |
| `arduino_code/05_esp32_wifi_version/secrets.example.h` | Template for the board's own Firebase login - copy to `secrets.h` to switch cloud sync on |
| `arduino_code/04_smart_dustbin_complete/` | The same system on an Arduino UNO, no networking |
| `src/` | The same firmware split into proper modules |
| `website/assets/js/sim.js` | The JavaScript twin of the firmware |
| `tests/twin.test.js` | 88 automated assertions |

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

## Full-bin lockdown

Present in **all three** builds - `04`, `05` and `src/` - and mirrored in the
JavaScript twin, so the same four lines describe the behaviour everywhere.

### Why

The original firmware had a bug that is easy to miss and embarrassing to
demonstrate: a **FULL** bin still opened its lid for a hand. That is precisely
how a bin overflows onto the pavement - the sensors correctly say "full", the
dashboard correctly says "collect now", and the lid cheerfully accepts three
more bags before the van arrives. A full bin should refuse.

### The policy is one function

```c
bool binLocked() { return binStatus == BIN_FULL; }
```

In `src/` the same line lives in `bin_level.cpp` as `binLevelIsLocked()`, next
to the thresholds that decide `BIN_FULL`, and the lid module receives the
answer as a parameter. Policy in one place, enforcement in another.

Note what is **not** in that line. `BIN_ERROR` does not lock. When both level
sensors have failed the bin has no idea how full it is, and stranding every
user on a guess is worse than an occasional overfill. **Fail usable, not fail
shut.** Being able to justify that choice is worth more in a viva than the
feature itself.

### Enforcement, and the latch

```c
case LID_CLOSED:
  if (handDetected && binLocked()) {
    if (!refusalLatched) {
      refusalLatched = true;
      refusedCount++;
      Serial.println(F("### Bin FULL - lid locked until it is emptied"));
    }
  } else if (handDetected) {
    lidServo.write(ANGLE_OPEN); openCount++;
    enterLidState(LID_OPENING, now);
  }
  break;
```

`refusalLatched` is the interesting part. The hand sensor is polled every
60 ms, so without it one person standing at the bin would be counted - and
printed - about **16 times a second**. The latch is cleared at the top of the
function whenever no hand is seen:

```c
if (handDetected) lastSeenHandAt = now;
else              refusalLatched = false;   /* hand gone: next approach counts */
```

So `refusedCount` counts **approaches**, not sensor polls. That is a number
worth putting on a dashboard: "this bin turned away 34 people today" is the
argument for sending the van sooner.

### The two things that still open a locked bin

**1. Safety beats lockdown.** The `LID_CLOSING` to `LID_OPENING` re-open
happens even if the bin became FULL while the lid was on its way down. A lid
must never close on somebody's hand, whatever the fill level says. There is
deliberately no `binLocked()` test in that branch.

**2. The crew override.** `OPEN` opens a locked bin - that is how the crew
gets at the rubbish - and the acknowledgement says so, so nobody reads it as
the lockdown having failed:

```c
return binLocked() ? "lid forced open (crew override - bin FULL)"
                   : "lid forced open";
```

`AUTO` hands control back; the lid closes normally and a still-full bin
re-locks as soon as it reaches `LID_CLOSED`.

### Releasing the lock

`EMPTY` sets `binStatus = BIN_OK` and resets `refusedCount` to 0. A level
reading back below 90 % releases it too, so a crew that empties the bin
without sending the command is not punished for it. Nothing needs to "unlock"
explicitly, because `binLocked()` is computed, never stored - there is no lock
flag that can get stuck.

### Where it shows up

| Surface | What appears |
|---|---|
| Serial, per approach | `### Bin FULL - lid locked until it is emptied` |
| Serial telemetry line | ` \| LOCKED` after `Opens`, before the UNEVEN / DEGRADED tags |
| JSON (`buildStatusJson`) | `"locked":true,"refused":7` |
| LCD row 1 | `Fill: 95% LOCKED` - exactly 16 characters |
| Boot banner | `   Full lockdown  : ON (crew override: OPEN)` |
| Built-in web page (05) | A red `LOCKED - FULL` line with the refusal count |
| Dashboard twin | A white padlock on the bin and `LOCKED - FULL` above it |

---

## The modular version in `src/`

Same behaviour, organised the way production firmware is:

| File | Responsibility |
|---|---|
| `config.h` | Every pin, threshold and timing constant |
| `ultrasonic.h/.cpp` | HC-SR04 driver, median filtering, validity checks |
| `lid.h/.cpp` | The servo state machine, including lockdown enforcement |
| `bin_level.h/.cpp` | Fill maths, status classification and the lockdown policy |
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

## Cloud sync (ESP32 only)

**File:** the same sketch, everything below the `CLOUD SYNC` banner.

`/api/status` only works if your browser is on the same Wi-Fi as the board.
Cloud sync removes that limit: the board reports into Firestore and the
dashboards read Firestore, so **no browser ever talks to the board**.

```
board --report every 5-60 s--> bins/BIN-001.device     --> dashboards
board <--poll every 10 s------ bins/BIN-001.command    <-- a dashboard
board --acknowledge----------> bins/BIN-001.commandAck --> that dashboard
```

### The switch is a file, not a #define

```c
#if __has_include("secrets.h")
  #include "secrets.h"
  #define CLOUD_SYNC 1
#else
  #define CLOUD_SYNC 0
#endif
```

Drop a `secrets.h` next to the sketch and sync turns on; delete it and all the
networking code compiles out again. There is no flag to forget to flip, and
`secrets.h` is in `.gitignore`, so the board's password cannot reach GitHub.
The cost is measurable: **75 % of flash without it, 90 % with** - most of the
difference is the 66 KB Mozilla root-certificate bundle that lets TLS verify
it is really talking to Google.

### Why an RTOS task on core 0

This is the part worth explaining in a viva.

One HTTPS request costs **0.5 to 2 seconds** - a TLS handshake plus a round
trip to Google. Run that inside `loop()` and the lid ignores hands for that
long, several times a minute. A bin that occasionally refuses to open for two
seconds is a broken bin.

The ESP32 has **two cores** and runs FreeRTOS, so the networking gets a task
of its own:

```c
xTaskCreatePinnedToCore(cloudTask, "cloud", 12288, NULL, 1, NULL, 0);
/*                      function   name    stack  arg  pri  hdl  core */
```

| Core | Runs | May block? |
|---|---|---|
| 1 | `loop()` - sensors, lid, LEDs, LCD, web page | never |
| 0 | `cloudTask` - sign in, report, poll, acknowledge | yes |

Core 0 is chosen because the Wi-Fi driver already lives there; priority 1 is
just above idle, so the task never out-ranks anything that matters. The stack
is 12 KB because a TLS handshake needs a deep one - `CLOUD` prints the
high-water mark so you can prove it is enough rather than guess.

The task begins each pass with `vTaskDelay(pdMS_TO_TICKS(250))`. That is not a
pause for convenience: an RTOS task that never blocks starves the idle task on
its core, and the task watchdog then resets the chip.

### The hand-off between the cores

Two cores genuinely running at the same time cannot simply share variables.
There are exactly two channels:

**1. A snapshot struct, copied under a critical section.** `loop()` builds a
plain-value struct - no `String`, no pointers, so assigning it copies
everything - and swaps it in:

```c
portENTER_CRITICAL(&cloudMux);
cloudSnap = s;                 /* one struct assignment, a microsecond or two */
portEXIT_CRITICAL(&cloudMux);
```

The struct is built **outside** the lock and only the copy happens inside, so
the other core is held up for as short a time as possible. Without the lock
the cloud task could read a struct that was half old and half new - a bin
reporting the new fill with the old status.

**2. Two FreeRTOS queues,** which are thread-safe by design:

```
cloudCmdQueue :  task (core 0)  -->  loop() (core 1)     a command to run
cloudAckQueue :  loop() (core 1) --> task (core 0)       the result to report
```

`loop()` drains the command queue every pass with a zero timeout - it never
waits - and runs each command through the *same* `applyCommand()` that HTTP
and serial use. **The servo is therefore only ever driven from core 1.** That
is the rule the whole design exists to protect.

### Never replay a command after a reboot

The first successful poll after power-up only **records** the id of whatever
command is sitting in the document; it does not run it:

```c
if (!cloudBaselined) { cloudBaselined = true; cloudLastCmdId = id; return; }
```

The board keeps nothing across a reboot, so it cannot know whether it already
obeyed that command. An `OPEN` queued at lunchtime must not swing the lid open
by itself when the power comes back at 3 a.m. The dashboard simply sees no
acknowledgement, and the operator sends it again. This is the same reasoning
behind idempotency keys in payment APIs: when you cannot tell a repeat from a
first attempt, do not act.

### The quota maths

Firestore's free tier is **20,000 writes and 50,000 reads per day for the
whole project**, so the intervals are not arbitrary:

| Activity | Interval | Per board per day |
|---|---|---|
| Poll for a command | 10 s | 8,640 reads |
| Heartbeat (nothing changed) | 60 s | 1,440 writes |
| Change-driven push (worst case) | 5 s floor | 17,280 writes |

A quiet bin costs about 1,440 writes; a busy one cannot exceed 17,280 because
of the 5-second floor. So **one board fits comfortably and a handful fit for a
demo** - but a real fleet of 50 would blow through both limits before lunch.
The honest answer to "how would you scale this?" is: lengthen the intervals,
or stop polling and move to MQTT, where the broker pushes to the device and
an idle bin costs nothing at all.

This is also why the simulated fleet in `data.js` is a pure function of time
rather than a random walk: every open browser tab would otherwise be writing
its own random numbers into the same documents.

### Tokens, failures and the serial `CLOUD` command

- Sign-in is `POST identitytoolkit.googleapis.com/...:signInWithPassword`,
  which returns an `idToken` good for an hour plus a `refreshToken`.
- The token is refreshed with 5 minutes to spare, using the refresh token so
  the password is not sent again. An HTTP **401** triggers one re-sign-in and
  one retry.
- Every path that talks to Google sits behind one back-off gate: 15 s after
  the first failure, doubling to a 5-minute cap. Retrying four times a second
  while the network is down achieves nothing and gets the account temporarily
  blocked by Google.
- **403** prints `rules not published, or this device's UID is not in
  deviceBins()`, because that is the cause almost every time.
- Failures are announced once, when the HTTP code *changes*, not every 10
  seconds - a log that repeats the same line forever is a log nobody reads.

Type `CLOUD` at the serial monitor for the whole picture: enabled, signed in,
device UID, last push age, push and poll counts, last HTTP code, last command
id and the task's free stack.

### What the board is allowed to write

The Firestore rules let the device account touch **only** the `device` and
`commandAck` fields of its own `bins/<DEVICE_ID>` document:

| Field | Type | Meaning |
|---|---|---|
| `device.fill`, `fillA`, `fillB` | integer | Fused and per-sensor percentage; `-1` = no echo |
| `device.opens`, `refused`, `errors` | integer | Lifetime counters |
| `device.sensors` | integer | 2 healthy, 1 degraded, 0 failed |
| `device.rssi` | integer | Wi-Fi signal, dBm |
| `device.lid`, `status`, `firmware` | string | `CLOSED`/`OPENING`/`OPEN`/`CLOSING`, `OK`/`WARNING`/`FULL`/`SENSOR_ERROR`, `2.0.0-wifi` |
| `device.locked` | boolean | The lockdown |
| `device.reportedAt` | timestamp | Set by the **server**, never by the board |
| `commandAck.id`, `.result` | string | Which command, and what it did |
| `commandAck.at` | timestamp | Set by the server |

The timestamps are written with `updateTransforms` /
`setToServerValue: REQUEST_TIME` rather than being sent as values. The board
has no trustworthy clock, and the rules reject any time that is not the
server's own - so a board with a wrong clock, or a malicious one, cannot
backdate its telemetry.

Everything is assembled with `String` concatenation and read back with small
`indexOf()` helpers rather than ArduinoJson. Nothing a user typed ever enters
the JSON: only numbers, fixed enum words, and a command id that has been
checked character by character (`cloudIdIsSafe()` - letters, digits, `-`, `_`,
40 max). Anything else is dropped rather than escaped.

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

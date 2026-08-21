# Smart Dustbin - Industry Oriented Embedded System

**Project report**

| | |
|---|---|
| **Student** | Nischay |
| **Institution** | Malla Reddy College of Engineering and Technology |
| **Course** | Embedded Systems |
| **Repository** | `https://github.com/<username>/Smart-Dustbin-Embedded-System` |
| **Live demo** | `https://<username>.github.io/Smart-Dustbin-Embedded-System/website/` |
| **Wokwi simulation** | `https://wokwi.com/projects/<id>` |

> Fill in the three placeholder links once you have published. Everything else
> in this report is complete.

---

## 1. Abstract

This project implements a smart dustbin: an embedded system that opens its lid
without being touched and reports how full it is to a central dashboard. It is
built on an **ESP32** with three HC-SR04 ultrasonic sensors, an SG90 servo,
LED and buzzer indicators and an optional I2C LCD. The ESP32 was chosen over
an Arduino UNO because it costs less, runs roughly fifteen times faster, has
substantially more memory, and includes Wi-Fi - which is what allows the bin
to expose a REST API that a central dashboard can read and command. The same
firmware also builds for an Arduino UNO, minus the networking.

The distinguishing design decision is the use of **two ultrasonic sensors
inside the bin**, mounted on opposite diagonals, whose readings are fused into
a single fill percentage. A single downward sensor measures one point of a
surface that is never flat, and consequently misreports the fill level
whenever rubbish is piled unevenly - by as much as 37 percentage points in the
case measured here. Fusing two diagonals corrects that, provides redundancy if
one sensor fails, and produces an uneven-load diagnostic that a single sensor
cannot generate at all.

The firmware is structured as a non-blocking cooperative scheduler with a
four-state lid controller. It is accompanied by a web layer - a public status
page and an authenticated fleet dashboard with a live map - and by 64
automated tests.

---

## 2. Objectives

1. Eliminate hand contact with the bin lid.
2. Measure waste level accurately enough to drive collection decisions.
3. Alert locally (LED, buzzer, display) and remotely (telemetry).
4. Remain fully demonstrable without physical hardware.
5. Apply the embedded concepts of the course: GPIO, PWM, pulse timing, state
   machines, threshold logic, calibration, filtering and fault handling.

---

## 3. Problem statement

Public bin lids are a hand-contact surface shared by everyone who uses them.
Separately, waste collection is normally scheduled by timetable rather than by
need, so vans visit bins that are nearly empty while bins in busy locations
overflow between visits.

The first problem is solved by automating the lid. The second is solved by
making each bin able to report its own fill level, so collection can be
planned from evidence.

---

## 4. System design

### 4.1 Sensor layout

| Sensor | Position | Aim | Function |
|---|---|---|---|
| #1 HAND | Outside, front face | Horizontally outward | Lid trigger |
| #2 LEVEL A | Inside, under the lid, front-left | Straight down | Fill, left diagonal |
| #3 LEVEL B | Inside, under the lid, rear-right | Straight down | Fill, right diagonal |

### 4.2 Pin assignment

| Function | ESP32 GPIO | Arduino UNO |
|---|---|---|
| Hand TRIG / ECHO | 5 / 18 | D2 / D3 |
| Level A TRIG / ECHO | 19 / 23 | D4 / D5 |
| Level B TRIG / ECHO | 32 / 33 | D8 / D9 |
| Servo signal | 13 | D6 |
| Buzzer | 25 | D7 |
| Green LED | 26 | D10 |
| Red LED | 27 | D12 |
| LCD SDA / SCL | 21 / 22 | A4 / A5 |

On the ESP32 each of the three HC-SR04 ECHO lines requires a 1 kΩ / 2 kΩ
divider, because the sensor drives 5 V into a 3.3 V-only GPIO. The Arduino UNO
is a 5 V part and needs no level shifting.

### 4.3 Software architecture

`loop()` dispatches four tasks by comparing `millis()` against per-task
timestamps: hand detection every 60 ms, level measurement every 1000 ms,
telemetry every 2000 ms, and alerts plus display on every pass. On the ESP32,
`server.handleClient()` and the serial command parser also run every pass.
There is effectively no `delay()` in the main loop, so no task can starve
another, and HTTP requests are answered promptly even while the lid is moving.

The lid is a four-state machine - CLOSED, OPENING, OPEN, CLOSING - with a
re-entrant hold timer and a safety transition from CLOSING back to OPENING if
an obstruction reappears during travel.

---

## 5. Measurement principle

An HC-SR04 is triggered with a 10 us pulse, emits eight 40 kHz bursts, and
holds ECHO high for the flight time of the sound. With sound at approximately
343 m/s and the pulse travelling out and back:

```
distance_cm = echo_microseconds / 58.31
```

Fill level is then derived against a calibrated bin height:

```
fillPercent = (BIN_HEIGHT_CM - measuredDistance) / BIN_HEIGHT_CM x 100
```

### 5.1 Dual-sensor fusion

```
fused  = (fillA + fillB) / 2
uneven = |fillA - fillB| > 25
```

| Condition | Behaviour |
|---|---|
| Both sensors valid | Average; flag if they disagree by more than 25 points |
| One sensor valid | Use it, report `sensors=1` (degraded but operating) |
| Neither valid | `SENSOR_ERROR`; hold the last value rather than publish a wrong one |

### 5.2 Measured benefit

With a box resting under sensor A:

| | Reading | Reported fill | Decision |
|---|---|---|---|
| Sensor A alone | 3.6 cm | 88 % | Dispatch a van (incorrect) |
| Sensor B alone | 25.8 cm | 14 % | Ignore (incorrect) |
| **Fused** | - | **51 %** | **No action, plus uneven-load flag (correct)** |

The single-sensor error in this case is 37 percentage points, and it is an
error in the direction that costs money - an unnecessary collection trip.

---

## 6. Alert policy

| Fill | Status | Green | Red | Buzzer |
|---|---|---|---|---|
| 0-74 % | OK | on | off | silent |
| 75-89 % | WARNING | on | slow blink | silent |
| 90-100 % | FULL | off | solid | 200 ms every 2 s |
| No reading | SENSOR_ERROR | off | fast blink | silent |

The buzzer uses a short periodic chirp rather than a continuous tone. A
continuous alarm in a corridor is disabled by staff within a day, and a
disabled alert protects nothing.

---

## 7. Results

### 7.1 Build verification

All sketches compiled with `arduino-cli` against the official toolchains.

| Sketch | Target | Flash | RAM |
|---|---|---|---|
| **`05_esp32_wifi_version`** | **ESP32** | **983,221 B (75 %)** | **46,144 B (14 %)** |
| `04_smart_dustbin_complete` | UNO | 16,640 B (51 %) | 836 B (40 %) |
| `01_lid_module` | UNO | 5,434 B (16 %) | 246 B (12 %) |
| `02_bin_level_module` | UNO | 6,318 B (19 %) | 204 B (9 %) |
| `03_alert_module` | UNO | 4,056 B (12 %) | 220 B (10 %) |
| `src/` modular build | UNO | 13,414 B (41 %) | 793 B (38 %) |
| `tinkercad_sketch` | UNO | 12,584 B (39 %) | 454 B (22 %) |

Compiled with `--warnings all`: no warnings originate from project code.

### 7.2 Test results

`node tests/twin.test.js` - **64 assertions, 64 passed, 0 failed**, covering
the fill formula, clamping, status bands and their boundaries, all four lid
transitions, the 25 cm detection boundary, the skip-while-open rule, all four
fusion cases and the command set.

19 manual integration cases are recorded in `data/test_results.csv`.

### 7.3 Simulation

The ESP32 Wokwi circuit (`simulation/wokwi/diagram.json`) imports as 11 parts
and 27 connections, with all 16 board pin references resolving against the
real `board-esp32-devkit-c-v4` part and both required libraries installing
cleanly. Wi-Fi is available in the simulator through its built-in
`Wokwi-GUEST` network, so the REST API is exercisable without hardware.

One implementation detail was caught only by testing against the real board:
Wokwi names the ESP32 GPIOs `esp:5`, `esp:18` and so on - **bare numbers**.
The pins named `esp:D0` to `esp:D3` are the *flash* interface, not GPIO 0-3,
and referencing `esp:D5` produces a silently dead wire rather than an error.

---

## 8. Limitations

1. The servo is open loop - a jammed lid cannot be detected.
2. Two sensors sample two points, not a volume; a narrow spike between them is
   invisible.
3. No temperature compensation; the speed of sound varies about 0.6 m/s per
   degree Celsius.
4. The website login is client-side and is documented as a demo, not as
   security.
5. Wi-Fi is unsuitable for street furniture; LoRaWAN or NB-IoT would be used
   in deployment. The ESP32 also draws current in bursts when transmitting,
   which requires a supply with headroom and local decoupling.

---

## 9. Future work

Deep sleep with a long-range radio for battery operation; a limit switch for
closed-loop lid control; temperature compensation; tamper and fire detection;
signed over-the-air updates; waste segregation sensing; solar charging.

---

## 10. Conclusion

The system meets all five objectives. The touchless lid responds within
approximately 100 ms and includes a safety re-open. The dual-sensor fill
measurement is materially more accurate than the conventional single-sensor
arrangement, and degrades gracefully rather than failing outright. All
firmware compiles within comfortable resource margins on both the ESP32 and an
ATmega328P, the logic is covered by automated tests, and the entire system - including the
management dashboard - can be demonstrated without any physical hardware.

---

## Appendices

| Appendix | Location |
|---|---|
| A - Full source code | `src/`, `arduino_code/` |
| B - Circuit diagram and pin tables | `circuit_diagram/` |
| C - Captured serial session | `data/sample_serial_output.txt` |
| D - Calibration table | `data/calibration_table.csv` |
| E - Test results | `data/test_results.csv` |
| F - Screenshots | `screenshots/` |
| G - Full documentation set | `docs/` (19 sections) |

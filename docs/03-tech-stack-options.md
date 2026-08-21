# 3. Tech Stack / Hardware Options

Three build levels. Pick one, finish it, then upgrade if you have time.

---

## Option A - Easy

**Components**

| Item | Qty | Approx cost (INR) |
|---|---|---|
| Arduino UNO R3 | 1 | 500 - 800 |
| HC-SR04 ultrasonic sensor | 1 | 60 - 100 |
| SG90 servo motor | 1 | 100 - 150 |
| LED (any colour) + 220 Ω resistor | 1 | 5 |
| Active buzzer | 1 | 20 |
| Breadboard + jumper wires | 1 set | 150 |

**Difficulty:** beginner. Two components, one sensor, one actuator.

**What it does:** the lid opens when a hand comes close and shuts a few
seconds later. No fill-level measurement at all.

**Expected output:** Serial Monitor prints a distance every 100 ms and a line
each time the lid changes state. The servo visibly sweeps.

**Hardware mandatory?** No. Runs perfectly in Wokwi or Tinkercad.

**Honest assessment:** this is a *touchless lid*, not a *smart dustbin*. It
demonstrates GPIO, ultrasonic timing and PWM, but there is no level sensing,
so half the project brief is missing. Use it as a stepping stone, not as your
final submission.

---

## Option B - Arduino UNO build

**Components**

| Item | Qty | Approx cost (INR) |
|---|---|---|
| Arduino UNO R3 (or ESP32) | 1 | 500 - 800 |
| HC-SR04 ultrasonic sensor | **3** | 180 - 300 |
| SG90 servo motor | 1 | 100 - 150 |
| Green LED + Red LED | 2 | 10 |
| 220 Ω resistors | 2 | 5 |
| Active buzzer | 1 | 20 |
| 16×2 I2C LCD (optional) | 1 | 200 - 300 |
| Breadboard + jumpers | 1 set | 150 |
| 5 V / 2 A adapter | 1 | 200 |
| **Total** | | **≈ 1,300 - 1,800** |

**Difficulty:** moderate but very achievable. The only genuinely new idea over
Option A is running three sensors without them interfering, which is solved by
spacing the pings 12 ms apart.

**What it does:** everything in the brief. Touchless lid, fill percentage
fused from **two in-bin sensors**, uneven-load detection, redundancy if one
level sensor fails, three-band status, LED and buzzer alerts, LCD readout and
serial telemetry.

**Expected output:**

```
[14s] Hand=42.3cm | Lid=CLOSED | A=79% B=73% | Fill=76% | Status=WARNING | Opens=5
        [###############-----] 76%
{"id":"BIN-001","fill":76,"fillA":79,"fillB":73,"spread":6,"uneven":false,"sensors":2,...}
```

**Hardware mandatory?** No. The complete Wokwi diagram in
`simulation/wokwi/diagram.json` includes all three sensors and the LCD.

**Why this one:** it is the smallest build that demonstrates every concept the
course cares about - GPIO, PWM, timing, state machines, thresholds,
calibration, filtering, serial protocols and fault handling - while staying
inside a student budget and a two-week timeline.

---

## Option C - ESP32 (recommended) ⭐

**Components**

| Item | Qty | Approx cost (INR) |
|---|---|---|
| ESP32 DevKit V1 | 1 | 400 - 600 |
| HC-SR04 ultrasonic sensor | 3 | 180 - 300 |
| SG90 / MG90S servo | 1 | 100 - 350 |
| 0.96" OLED (SSD1306, I2C) | 1 | 250 - 400 |
| LEDs, resistors, buzzer | set | 50 |
| 1 kΩ + 2 kΩ resistors (level shifting) | 3 pairs | 10 |
| 18650 cell + TP4056 charger (optional) | 1 | 250 |

**Difficulty:** the algorithm is identical to Option B. The only new work is
the 3.3 V / 5 V interfacing, which is three resistor dividers.

**What it adds over Option B:**

- Wi-Fi connection and a built-in HTTP server
- `GET /api/status` returning live JSON telemetry
- `GET /api/command?cmd=OPEN` for genuine remote control
- The admin dashboard in `website/` can talk to the real board
- Multiple bins on one dashboard, each with its own IP
- A path to a cloud broker (MQTT, ThingSpeak, Firebase)

**Expected output:** the board prints its IP address at boot; visiting that IP
serves a status page, and the dashboard "Live device" panel starts showing
real readings instead of demo data.

**Hardware mandatory?** No - Wokwi simulates the ESP32 including Wi-Fi via the
built-in `Wokwi-GUEST` network. That is genuinely impressive in a demo.

**Watch out for:**
- The ECHO pin is 5 V and ESP32 GPIOs are 3.3 V. Use the divider in
  `circuit_diagram/connections.md`. This is the single most common way to
  destroy an ESP32 on this project.
- `Servo.h` does not work on ESP32. Install **ESP32Servo** instead.
- ADC2 pins are unusable while Wi-Fi is active - another reason to stick to
  the pin map given.

---

## Recommendation

**Build Option C, on the ESP32.** It is the primary target of this repository.

The reasoning is simple: the ESP32 is *cheaper* than an Arduino UNO, several
times faster, has far more memory, and adds Wi-Fi - which is what turns a
standalone gadget into something a city dashboard can actually manage. It also
simulates perfectly in Wokwi, Wi-Fi included, via the built-in `Wokwi-GUEST`
network.

The one genuine cost is the 3.3 V logic: each of the three HC-SR04 ECHO lines
needs a two-resistor divider on real hardware. That is six resistors and ten
minutes, and it is a good thing to be able to explain in a viva.

Everything here is written so both paths work from one code base with
identical logic:

| | Sketch | Simulation |
|---|---|---|
| **ESP32 (primary)** | `arduino_code/05_esp32_wifi_version` | `simulation/wokwi/` |
| Arduino UNO (alternative) | `arduino_code/04_smart_dustbin_complete` | `simulation/wokwi/uno/` |

If your lab only has UNOs, Option B loses nothing except the networking.

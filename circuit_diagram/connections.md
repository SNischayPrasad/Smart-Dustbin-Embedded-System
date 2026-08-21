# Circuit Connections

![Circuit diagram](smart_dustbin_circuit.svg)

Open `smart_dustbin_circuit.svg` in any browser for the full-size diagram.

---

## Sensor layout

The bin uses **three** HC-SR04 modules, and where they are mounted matters as
much as how they are wired.

| Sensor | Position | Aim | Job |
|---|---|---|---|
| **#1 HAND** | Outside, front face, waist height | Horizontally outward | Detects a hand, opens the lid |
| **#2 LEVEL A** | **Inside**, under the lid, front-left | Straight down | Measures the waste on the left diagonal |
| **#3 LEVEL B** | **Inside**, under the lid, rear-right | Straight down | Measures the waste on the right diagonal |

```
              lid (seen from below)
        +---------------------------+
        |  [A]                      |
        |        \                  |
        |          \                |
        |            \              |
        |              \            |
        |                     [B]   |
        +---------------------------+
```

A and B go on **opposite diagonals**, as far apart as the lid allows. Mounting
them side by side defeats the whole purpose: they would both see the same
patch of rubbish and you would gain nothing over a single sensor.

---

## 1. Master pin table - ESP32 (primary build)

The ESP32 is the default target for this project: it runs the same firmware
and adds Wi-Fi and a REST API. The Arduino UNO table follows in section 2.

| Component | Component pin | ESP32 GPIO | Direction | Wire colour in the diagram |
|---|---|---|---|---|
| HC-SR04 #1 (hand) | VCC | 5V / VIN | power | red |
| HC-SR04 #1 (hand) | TRIG | **GPIO5** | output from ESP32 | green |
| HC-SR04 #1 (hand) | ECHO | **GPIO18** | input to ESP32 | blue |
| HC-SR04 #1 (hand) | GND | GND | ground | black |
| HC-SR04 #2 (level A) | VCC | 5V / VIN | power | red |
| HC-SR04 #2 (level A) | TRIG | **GPIO19** | output from ESP32 | orange |
| HC-SR04 #2 (level A) | ECHO | **GPIO23** | input to ESP32 | violet |
| HC-SR04 #2 (level A) | GND | GND | ground | black |
| HC-SR04 #3 (level B) | VCC | 5V / VIN | power | red |
| HC-SR04 #3 (level B) | TRIG | **GPIO32** | output from ESP32 | yellow |
| HC-SR04 #3 (level B) | ECHO | **GPIO33** | input to ESP32 | indigo |
| HC-SR04 #3 (level B) | GND | GND | ground | black |
| SG90 servo | Signal (orange) | **GPIO13** | PWM output | amber |
| SG90 servo | V+ (red) | 5V / VIN | power | red |
| SG90 servo | GND (brown) | GND | ground | black |
| Active buzzer | + (long leg) | **GPIO25** | output | brown |
| Active buzzer | - (short leg) | GND | ground | black |
| Green LED | anode via 220 Ω | **GPIO26** | output | green |
| Green LED | cathode | GND | ground | black |
| Red LED | anode via 220 Ω | **GPIO27** | output | red |
| Red LED | cathode | GND | ground | black |
| 16×2 LCD (I2C) | SDA | **GPIO21** | I2C data | blue |
| 16×2 LCD (I2C) | SCL | **GPIO22** | I2C clock | indigo |
| 16×2 LCD (I2C) | VCC | 5V / VIN | power | red |
| 16×2 LCD (I2C) | GND | GND | ground | black |

**Free GPIOs after wiring:** 14, 15, 16, 17, 27, 34, 35, VP (36), VN (39).

> **Pin naming in Wokwi.** On the `board-esp32-devkit-c-v4` part the GPIO pins
> are named **`esp:5`, `esp:18`, `esp:19`** and so on - **bare numbers, no `D`
> prefix**. The pins called `esp:D0`, `esp:D1`, `esp:D2`, `esp:D3`, `esp:CMD`
> and `esp:CLK` are the **flash memory** pins, not GPIO 0-3. Writing `esp:D5`
> in `diagram.json` produces a silently dead wire rather than an error, so it
> is worth double-checking.

### ⚠ The ECHO voltage divider - needed three times

The ESP32 runs at **3.3 V**. The HC-SR04 ECHO pin drives **5 V**. Connecting
them directly works on the bench and slowly destroys the GPIO.

```
   HC-SR04 ECHO ----[ 1 kΩ ]----+----> ESP32 GPIO
                                |
                             [ 2 kΩ ]
                                |
                               GND
```

5 V × (2 kΩ / 3 kΩ) = **3.33 V**, exactly what the ESP32 expects. Fit one on
**each of the three ECHO lines**: GPIO18, GPIO23 and GPIO33.

TRIG needs no divider - a 3.3 V pulse is comfortably above the HC-SR04 input
threshold.

*(The Wokwi simulation omits the dividers, because there is nothing to damage
in a simulator and they would only clutter the diagram.)*

---

## 2. Master pin table - Arduino UNO (alternative build)

Use this if you have an UNO rather than an ESP32. Identical behaviour, minus
the Wi-Fi and the REST API. Sketch:
`arduino_code/04_smart_dustbin_complete`.

| Component | Component pin | Arduino pin | Direction |
|---|---|---|---|
| HC-SR04 #1 (hand) | TRIG / ECHO | **D2 / D3** | out / in |
| HC-SR04 #2 (level A) | TRIG / ECHO | **D4 / D5** | out / in |
| HC-SR04 #3 (level B) | TRIG / ECHO | **D8 / D9** | out / in |
| SG90 servo | Signal | **D6** | PWM out |
| Active buzzer | + | **D7** | out |
| Green LED | anode via 220 Ω | **D10** | out |
| Red LED | anode via 220 Ω | **D12** | out |
| 16×2 LCD (I2C) | SDA / SCL | **A4 / A5** | I2C |

All VCC pins to 5 V, all GND pins to GND.
**Free pins after wiring:** D11, D13, A0–A3.

No level shifting is needed on the UNO - it is a 5 V part, so the HC-SR04
ECHO lines connect directly.

> `Servo.h` claims Timer1, which disables `analogWrite()` PWM on **D9 and
> D10**. Both are used here as plain digital pins, so nothing is lost - just
> do not try to `analogWrite()` to them.

The UNO wiring diagram is kept at
[`smart_dustbin_circuit_uno.svg`](smart_dustbin_circuit_uno.svg).

---

## 3. Step-by-step wiring order

Wire it in this order and test after each step. Debugging five components at
once is far harder than debugging one.

> The staging sketches `01_lid_module`, `02_bin_level_module` and
> `03_alert_module` are written for the **Arduino UNO** pin map. On an ESP32,
> either change the pin constants at the top of each one to the GPIO numbers
> in the table above, or skip them and bring the system up with the full
> `05_esp32_wifi_version` sketch, which prints a per-sensor self test at boot
> that tells you which sensors are answering.

**Step 1 - power rails.**
Run a red jumper from `5V` to the red rail of the breadboard, and a black
jumper from `GND` to the blue rail. Every component now takes power from the
rails, not from the board directly.

**Step 2 - hand sensor.**
HC-SR04 #1: VCC → 5 V rail, GND → GND rail, TRIG → GPIO5, ECHO → GPIO18 (through the divider).
Upload `01_lid_module` and confirm the Serial Monitor prints a distance that
changes when you move your hand.

**Step 3 - servo.**
Orange → GPIO13, red → 5 V rail, brown → GND rail. The lid should sweep at
power-on because of the self test.

**Step 4 - level sensor A.**
HC-SR04 #2: TRIG → GPIO19, ECHO → GPIO23 (divider), power to the rails.
Mount it under the lid, front-left, pointing straight down.

**Step 5 - level sensor B.**
HC-SR04 #3: TRIG → GPIO32, ECHO → GPIO33 (divider), power to the rails.
Mount it under the lid on the **opposite diagonal** to A. Upload `02_bin_level_module` and check that
with an empty bin both sensors report roughly the same distance.

**Step 6 - LEDs.**
Long leg of the green LED → one end of a 220 Ω resistor → GPIO26.
Short leg → GND rail. Repeat for the red LED with GPIO27.

**Step 7 - buzzer.**
Long leg → GPIO25, short leg → GND rail.

**Step 8 - LCD (optional).**
SDA → GPIO21, SCL → GPIO22, VCC → 5 V rail, GND → GND rail.

**Step 9 - full firmware.**
Upload `05_esp32_wifi_version` and run through the test plan in
`docs/13-testing-strategy.md`.

---

## 4. Mounting the two level sensors

This is mechanical, not electrical, and it is where the accuracy actually
comes from.

1. **Opposite diagonals, maximum separation.** The further apart A and B are,
   the better the average represents the whole surface.
2. **Both perfectly vertical.** A tilted sensor measures a diagonal, which
   always reads longer than the true depth, so that side looks emptier than
   it is.
3. **Both at the same height.** If A sits 2 cm lower than B, it will read 2 cm
   less on an empty bin and the firmware will think the load is permanently
   uneven. Shim them level, then calibrate.
4. **Clear of the hinge and the bag rim.** A folded bin-liner edge in the beam
   produces a permanent false "full" on that side.
5. **Calibrate after mounting, not before.** Empty the bin, read both
   distances, and use them to set `BIN_HEIGHT_CM`. If A and B differ by more
   than about 1 cm on an empty bin, fix the mounting before touching the code.

---

## 5. Common wiring mistakes

| Symptom | Almost always caused by |
|---|---|
| Distance always reads 0 or nothing | TRIG and ECHO swapped |
| A and B always disagree wildly | One sensor is tilted, or they are mounted at different heights |
| Both level sensors read the same wrong value | They are mounted too close together |
| Readings jump randomly | No shared ground, or the two level sensors are firing simultaneously |
| Servo jitters and the board resets | Servo drawing too much current from the USB port |
| LED never lights | LED fitted backwards - the long leg is the anode |
| LED is very dim | Resistor value too high, use 220 Ω not 10 kΩ |
| LCD backlight on but no text | Wrong I2C address - change `0x27` to `0x3F` |
| `UNEVEN LOAD` appears on an empty bin | A and B are not level with each other |
| Nothing works at all | GND rail not connected back to the board |
| ESP32 reboots randomly | Brown-out from the servo or a Wi-Fi burst - use a 2 A supply and a 470 µF cap |
| ESP32 GPIO stops responding after days | 5 V ECHO fed straight into a 3.3 V pin - fit the dividers |
| Wokwi wire appears connected but does nothing | Pin written as `esp:D5`; it must be `esp:5` |

---

## 6. Why the sensors are fired one at a time

All three modules transmit on the same 40 kHz frequency. If A and B ping
simultaneously, each can hear the other's burst and report a nonsense
distance - a fault called **crosstalk**.

The firmware fires them in sequence with a 12 ms gap
(`SENSOR_SETTLE_MS`), which is longer than the flight time to the far wall
and back, so the echoes from A have died away before B transmits.

```c
distA = readDistanceMedian(PIN_TRIG_LEVEL_A, PIN_ECHO_LEVEL_A);
delay(SENSOR_SETTLE_MS);       /* let A's echoes die before B fires */
distB = readDistanceMedian(PIN_TRIG_LEVEL_B, PIN_ECHO_LEVEL_B);
```

This is the one place in the firmware where a short blocking `delay()` is
acceptable: it runs once per second inside the level task, it is 12 ms long,
and the alternative (a fourth state machine) would add real complexity for no
practical gain.

---

## 7. Power budget

| Item | Typical | Peak |
|---|---|---|
| ESP32 (Wi-Fi active) | 80 mA | **240 mA in TX bursts** |
| HC-SR04 × 3 | 45 mA | 45 mA |
| SG90 servo | 10 mA idle | **650 mA while moving** |
| LEDs × 2 | 20 mA | 40 mA |
| Buzzer | 0 mA | 30 mA |
| LCD with backlight | 25 mA | 30 mA |
| **Total** | **~180 mA** | **~1,035 mA** |

A USB port supplies 500 mA, which is why the board sometimes resets when the
servo moves - and the ESP32 makes this worse, because a Wi-Fi transmit burst
and a servo movement can coincide. For any permanent build use a **5 V / 2 A**
adapter, power the servo directly from it, and join the grounds. A 470 µF
capacitor across the ESP32 supply rail smooths the Wi-Fi current spikes.

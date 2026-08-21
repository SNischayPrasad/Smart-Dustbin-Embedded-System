# 9. Circuit Diagram

The full wiring reference lives in the `circuit_diagram/` folder:

- **[`circuit_diagram/smart_dustbin_circuit.svg`](../circuit_diagram/smart_dustbin_circuit.svg)** - full colour diagram, vector, prints cleanly into a report.
- **[`circuit_diagram/connections.md`](../circuit_diagram/connections.md)** - master pin tables for both UNO and ESP32, the ECHO voltage divider, the assembly order, the fault table and the power budget.

This page is the short version, for quick reference while wiring.

---

## Sensor layout

Three HC-SR04 modules. **Where** they are mounted matters as much as how they
are wired.

| Sensor | Position | Aim | Job |
|---|---|---|---|
| #1 HAND | Outside, front face | Horizontally outward | Opens the lid |
| #2 LEVEL A | **Inside**, under the lid, front-left | Straight down | Waste depth, left diagonal |
| #3 LEVEL B | **Inside**, under the lid, rear-right | Straight down | Waste depth, right diagonal |

A and B go on **opposite diagonals**. Mounted side by side they would both see
the same patch of rubbish and you would gain nothing over a single sensor.

---

## Quick pin card - ESP32 (primary)

```
                    +---------------------------+
   HC-SR04 #1 TRIG--| GPIO5              5V/VIN |--to the 5 V rail
   HC-SR04 #1 ECHO--| GPIO18 *              GND |--to the GND rail
   HC-SR04 #2 TRIG--| GPIO19                    |
   HC-SR04 #2 ECHO--| GPIO23 *           GPIO21 |--LCD SDA
   Servo signal   --| GPIO13             GPIO22 |--LCD SCL
   Buzzer +       --| GPIO25                    |
   HC-SR04 #3 TRIG--| GPIO32                    |
   HC-SR04 #3 ECHO--| GPIO33 *                  |
   Green LED +220R--| GPIO26                    |
   Red LED   +220R--| GPIO27                    |
                    |     ESP32 DevKit V1       |
                    +---------------------------+

   * = fit a 1k/2k divider on this line (5 V sensor into a 3.3 V pin)
```

Free after wiring: **GPIO14, 15, 16, 17, 34, 35, VP, VN.**

### Quick pin card - Arduino UNO (alternative)

```
   Hand   TRIG D2  ECHO D3      Servo  D6      Green LED D10
   LevelA TRIG D4  ECHO D5      Buzzer D7      Red LED   D12
   LevelB TRIG D8  ECHO D9      LCD    A4 SDA / A5 SCL
```

Free after wiring: **D11, D13, A0-A3.** No level shifting needed - the UNO is
a 5 V part.

---

## Connection list

| Component | Pin | ESP32 | Arduino UNO |
|---|---|---|---|
| HC-SR04 #1 (hand) | TRIG | GPIO5 | D2 |
| HC-SR04 #1 (hand) | ECHO | GPIO18 * | D3 |
| HC-SR04 #2 (level A) | TRIG | GPIO19 | D4 |
| HC-SR04 #2 (level A) | ECHO | GPIO23 * | D5 |
| HC-SR04 #3 (level B) | TRIG | GPIO32 | D8 |
| HC-SR04 #3 (level B) | ECHO | GPIO33 * | D9 |
| Servo | Signal (orange) | GPIO13 | D6 |
| Buzzer | + (long leg) | GPIO25 | D7 |
| Green LED | anode via 220 Ω | GPIO26 | D10 |
| Red LED | anode via 220 Ω | GPIO27 | D12 |
| LCD | SDA | GPIO21 | A4 |
| LCD | SCL | GPIO22 | A5 |

All VCC pins to the 5 V rail, all GND pins to the GND rail.
`*` = needs a 1 kΩ / 2 kΩ divider on the ESP32.

---

## Why each connection is what it is

**Why TRIG is an output and ECHO an input.** TRIG is how the Arduino tells the
sensor to start measuring, so the Arduino drives it. ECHO is how the sensor
reports the flight time, so the Arduino listens to it. Swap them and the
reading is permanently zero, which is the single most common wiring fault on
this project.

**Why the servo is on D6.** It needs a PWM-capable pin. On the UNO those are
D3, D5, D6, D9, D10 and D11. D3 and D5 are taken by ECHO lines, so D6 is the
natural choice. Note that `Servo.h` claims Timer1, which disables
`analogWrite()` PWM on **D9 and D10** - both of which this project uses as
plain digital pins (ECHO input and an LED output), so nothing is lost. Just do
not try to `analogWrite()` to them.

**Why the two level sensors are fired one at a time.** All three modules
transmit on the same 40 kHz frequency. If A and B ping simultaneously each can
hear the other and report nonsense - a fault called crosstalk. The firmware
puts a 12 ms gap between them, longer than the flight time to the far wall and
back, so A's echoes have died away before B transmits.

**Why the LEDs need 220 ohm resistors.** An LED is a diode: above its forward
voltage it conducts almost freely, so the current has to be limited
externally. With a 5 V pin and a 2 V forward drop, a 220 ohm resistor sets the
current at about 14 mA - bright, and well inside the 20 mA per-pin limit.

**Why the LCD is on GPIO21 and GPIO22.** They are the ESP32's default I2C
pins. Unlike the UNO - where SDA and SCL are physically hard-wired to A4 and
A5 inside the chip - the ESP32 can route I2C to almost any pin, but staying on
the default pair means `Wire.begin()` works with no arguments and every
example you find online applies directly.

**Why everything shares one ground.** Voltage is only meaningful relative to
something. If a sensor and the Arduino do not share a ground reference, the
"5 V" the sensor sends is 5 V relative to *its* ground, which the Arduino has
no way to interpret. Missing ground is why a circuit that looks correct
behaves randomly.

---

## Safety notes

1. **Never wire 5 V straight into an ESP32 GPIO.** All three HC-SR04 ECHO
   lines need the 1 kΩ / 2 kΩ divider from `connections.md`. Without it the
   board survives on the bench and fails weeks later.
2. **Do not power a loaded servo from the USB port.** USB supplies 500 mA; the
   SG90 can draw 650 mA while moving. Use a 5 V / 2 A adapter and join the
   grounds.
3. **Always check polarity before applying power.** A reversed HC-SR04 gets
   hot within seconds. If a component is warm, disconnect immediately.
4. **Disconnect power before rewiring.** Hot-plugging a jumper into the wrong
   hole is how boards die.

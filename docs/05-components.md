# 5. Hardware Components

For each part: what it is for, whether it is an input or an output, how it
connects, and what you should observe when it works.

---

## 1. ESP32 DevKit V1 (or Arduino UNO)

| | |
|---|---|
| **Purpose** | The brain. Reads all three sensors, decides everything, drives every output, and serves the REST API over Wi-Fi. |
| **Input/Output** | Both - it is the thing everything else connects to |
| **Connection role** | Provides 5 V and GND rails plus 14 digital and 6 analog pins |
| **Expected behaviour** | Power LED lit; on reset the self test blinks both LEDs, chirps the buzzer and sweeps the servo once |

**Key specs (ESP32-WROOM-32):** dual-core Xtensa LX6 at 240 MHz, 4 MB flash,
520 KB SRAM, Wi-Fi 802.11 b/g/n and Bluetooth, **3.3 V logic**, 12 mA per pin.

**Key specs (Arduino UNO):** ATmega328P, 16 MHz, 32 KB flash, 2 KB SRAM,
5 V logic, 20 mA per pin.

**Why the ESP32 is the primary target:** it costs less than an UNO, runs about
15x faster, has 250x the RAM, and has Wi-Fi built in - which is what lets the
bin talk to the city dashboard. The only cost is that its GPIOs are 3.3 V, so
each 5 V HC-SR04 ECHO line needs a resistor divider.

**Choose the UNO instead if** your lab supplies them, or your syllabus names
the ATmega328P specifically. The logic is identical; you lose only Wi-Fi.

---

## 2. HC-SR04 #1 - hand / object detection

| | |
|---|---|
| **Purpose** | Detects a hand or a person approaching the front of the bin |
| **Input/Output** | TRIG is an output from the Arduino, ECHO is an input to it |
| **Connection role** | VCC to 5 V, GND to GND, TRIG to D2, ECHO to D3 |
| **Expected behaviour** | Serial Monitor shows a falling distance as your hand approaches; under 25 cm the lid opens |

**Mounting:** on the front face of the bin, roughly at waist height, aimed
horizontally outward. Aim it slightly downward if people walking past keep
triggering it.

**Specs:** 2 cm to 400 cm range, about 3 mm resolution, 15 degree beam angle,
15 mA current draw, minimum 60 ms between measurements for a clean reading.

---

## 3 and 4. HC-SR04 #2 and #3 - bin level detection (both INSIDE the bin)

| | |
|---|---|
| **Purpose** | Measure the empty space between the lid and the top of the rubbish, from two different points |
| **Input/Output** | TRIG output, ECHO input (each) |
| **Connection role** | **A:** TRIG D4, ECHO D5. **B:** TRIG D8, ECHO D9. Both VCC to 5 V, GND to GND |
| **Expected behaviour** | Both read about 30 cm when empty and drop towards 0 as the bin fills |

**Mounting is the critical part, and it is where the accuracy comes from.**

```
              lid, seen from below
        +---------------------------+
        |  [A]                      |
        |        \                  |
        |          \   diagonal      |
        |            \              |
        |                     [B]   |
        +---------------------------+
```

1. **Opposite diagonals, as far apart as the lid allows.** Side by side, they
   see the same patch of rubbish and you gain nothing.
2. **Both perfectly vertical.** A tilted sensor measures a diagonal, which
   reads longer than the true depth, so that side looks emptier than it is.
3. **Both at the same height.** If A sits 2 cm lower than B it will always
   read 2 cm less, and the firmware will think the load is permanently
   uneven. Shim them level, then calibrate.
4. **Clear of the hinge and the bag rim.** A folded liner edge in the beam
   gives a permanent false "full" on that side.

### Why three sensors instead of two

The hand sensor and the level sensors answer completely different questions.
One asks "is somebody there?" and must be fast (checked every 60 ms); the
others ask "how much rubbish is there?" and must be accurate and stable
(checked once a second, median filtered). A single sensor cannot look in two
directions at once.

And the reason there are **two** level sensors rather than one is that rubbish
is never flat. One sensor sitting over a peak reports "full" while the bin is
half empty; one over a hollow reports the opposite. Averaging two diagonals
gives a far better estimate, keeps the bin working if one sensor dies, and
lets the firmware detect a load piled to one side. The full argument and the
worked numbers are in `docs/12-bin-level-calculation.md`.

---

## 5. SG90 servo motor

| | |
|---|---|
| **Purpose** | Lifts and lowers the lid |
| **Input/Output** | Output - it receives a PWM command |
| **Connection role** | Orange to D6, red to 5 V, brown to GND |
| **Expected behaviour** | Rotates to 90 degrees when the lid opens, returns to 0 degrees about 3 s after the hand leaves |

**Specs:** roughly 1.8 kg-cm torque at 4.8 V, 0.1 s per 60 degrees, 180 degree
range, 650 mA stall current.

**The current draw is the thing that catches people out.** A USB port supplies
500 mA. If the board resets every time the lid moves, that is why - use a
separate 5 V supply for the servo and connect the grounds together.

**Mechanical note:** the servo horn attaches to the lid hinge with a short
linkage. Set `SERVO_ANGLE_OPEN` and `SERVO_ANGLE_CLOSED` to match your
mechanism rather than forcing the mechanism to match 0 and 90 degrees.

---

## 6. Active buzzer

| | |
|---|---|
| **Purpose** | Audible alert when the bin reaches 90 % |
| **Input/Output** | Output |
| **Connection role** | Long leg (+) to D7, short leg (-) to GND |
| **Expected behaviour** | Short 200 ms chirp roughly every 2 s while the bin is full; silent otherwise |

**Active vs passive:** an active buzzer has its own oscillator, so a plain
HIGH makes sound. A passive buzzer is really a tiny speaker and needs `tone()`.
If yours is silent on a HIGH, you have a passive one.

---

## 7. Green LED - normal status

| | |
|---|---|
| **Purpose** | Shows at a glance that the bin is fine and the system is alive |
| **Input/Output** | Output |
| **Connection role** | D10 to a 220 ohm resistor to the anode; cathode to GND |
| **Expected behaviour** | Solid on below 75 % fill; off once the bin is full |

The long leg is the anode (positive). If the LED never lights and the wiring
looks right, turn it around.

---

## 8. Red LED - full-bin status

| | |
|---|---|
| **Purpose** | Escalating visual warning |
| **Input/Output** | Output |
| **Connection role** | D12 to a 220 ohm resistor to the anode; cathode to GND |
| **Expected behaviour** | Off below 75 %, slow blink 75 to 89 %, solid at 90 % and above, fast blink on sensor error |

---

## 9. 16x2 LCD with I2C backpack (optional)

| | |
|---|---|
| **Purpose** | Local readout of lid state and fill percentage |
| **Input/Output** | Output (I2C) |
| **Connection role** | SDA to A4, SCL to A5, VCC to 5 V, GND to GND |
| **Expected behaviour** | Line 1 shows the lid state, line 2 shows fill percentage and status |

**If the backlight is on but nothing appears:** the I2C address is wrong.
Change `0x27` to `0x3F` in the sketch. If it is still blank, adjust the small
contrast potentiometer on the back of the backpack.

**To skip it entirely:** comment out `#define USE_LCD` at the top of the
sketch. Everything else keeps working.

---

## 10. Breadboard

| | |
|---|---|
| **Purpose** | Solderless prototyping |
| **Connection role** | The two long outer rails carry 5 V and GND to every component |
| **Expected behaviour** | A wire pushed in stays put and makes contact |

Remember the internal layout: the outer rails run the length of the board,
while the inner columns are connected in groups of five, split down the middle
channel.

---

## 11. Jumper wires

Male-to-male for breadboard work, male-to-female for connecting the HC-SR04
headers directly.

**Use the colour convention** - red for 5 V, black for GND, anything else for
signals. It is not decoration; it is what makes a wiring fault findable in
thirty seconds instead of thirty minutes.

---

## 12. Power supply

| Option | Suitable for |
|---|---|
| USB from a laptop (5 V, 500 mA) | Development and testing only |
| 5 V / 2 A adapter into the barrel jack | The proper choice for a working build |
| 4x AA battery pack (6 V) into VIN | Portable demo, but the servo drains it quickly |
| 9 V battery | **Avoid.** Tiny capacity, and the regulator wastes most of it as heat |

---

## Complete bill of materials

| # | Item | Qty | Approx INR |
|---|---|---|---|
| 1 | Arduino UNO R3 | 1 | 600 |
| 2 | HC-SR04 ultrasonic sensor | 3 | 240 |
| 3 | SG90 servo motor | 1 | 130 |
| 4 | Active buzzer | 1 | 20 |
| 5 | Green LED 5 mm | 1 | 3 |
| 6 | Red LED 5 mm | 1 | 3 |
| 7 | 220 ohm resistor | 2 | 4 |
| 8 | 16x2 I2C LCD | 1 | 250 |
| 9 | Breadboard 830 point | 1 | 120 |
| 10 | Jumper wires (40 pcs) | 1 set | 80 |
| 11 | 5 V / 2 A adapter | 1 | 200 |
| | **Total** | | **about 1,650** |

Everything except the physical bin itself. If you are simulating, the cost is
zero.

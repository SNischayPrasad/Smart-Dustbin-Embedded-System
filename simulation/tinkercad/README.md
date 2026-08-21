# Tinkercad Circuits - build instructions

Tinkercad is the fallback simulator, and it is **Arduino UNO only** - it has
no ESP32 part and no I2C LCD.

The primary simulation for this project is the **ESP32** one in
`simulation/wokwi/`, which runs the real compiled firmware including Wi-Fi.
Use Tinkercad only if your lab requires it, or as a backup in case Wokwi is
blocked on the exam network.

**Use `tinkercad_sketch.ino`, not the main sketch.** It is the UNO firmware
with the display removed. Everything else - all three sensors, the dual-sensor
fusion, the alerts and the serial commands - is identical.

---

## Build steps

1. Go to **tinkercad.com** and sign in.
2. **Circuits > Create new Circuit**.
3. From the components panel drag in:
   - 1x **Arduino Uno R3**
   - 3x **Ultrasonic Distance Sensor** (set each to **4-pin** mode in the
     inspector - the default is 3-pin, which will not work)
   - 1x **Micro Servo**
   - 2x **LED** (one green, one red)
   - 2x **Resistor**, set both to **220 ohm**
   - 1x **Piezo** (Tinkercad's buzzer)
   - 1x **Breadboard Small**

4. Wire to this pin map:

| Component | Pin | Arduino |
|---|---|---|
| Ultrasonic #1 (hand) | TRIG | D2 |
| Ultrasonic #1 (hand) | ECHO | D3 |
| Ultrasonic #2 (level A) | TRIG | D4 |
| Ultrasonic #2 (level A) | ECHO | D5 |
| Ultrasonic #3 (level B) | TRIG | D8 |
| Ultrasonic #3 (level B) | ECHO | D9 |
| Servo | signal | D6 |
| Piezo | + | D7 |
| Green LED | anode via 220 ohm | D10 |
| Red LED | anode via 220 ohm | D12 |

   All VCC pins to the 5 V rail, all GND pins to the ground rail.

5. Click **Code**, change the dropdown from **Blocks** to **Text**, and accept
   the warning.
6. Delete the default code and paste `tinkercad_sketch.ino`.
7. Click **Start Simulation**.
8. Click **Code > Serial Monitor** to see the telemetry.

---

## Driving it

Click any ultrasonic sensor while the simulation runs and a distance slider
appears above it.

| To show | Set |
|---|---|
| Lid opening | Hand sensor to 10 cm |
| Lid closing | Hand sensor back to 80 cm, wait 3 s |
| Empty bin | Both level sensors to 30 cm |
| Half full | Both level sensors to 15 cm |
| Warning | Both level sensors to 7.5 cm |
| Full + buzzer | Both level sensors to 3 cm |
| **Uneven load** | Level A to 3 cm, level B to 27 cm |
| Degraded mode | Delete one level sensor's ECHO wire |

---

## Known Tinkercad quirks

| Issue | Workaround |
|---|---|
| No I2C LCD component | Use `tinkercad_sketch.ino`, which has the LCD removed |
| Sensor defaults to 3-pin | Select it and switch to 4-pin in the inspector |
| Simulation runs slower than real time | Expected. Timings still work, they just feel sluggish |
| `Servo.h` sometimes needs a moment | Start, stop, and start again |
| Serial Monitor clears on restart | Screenshot before restarting |
| Piezo is passive, not active | It still makes a sound on a HIGH in Tinkercad's model |

---

## Which simulator to submit

Submit **Wokwi** as the primary evidence: it runs the actual compiled ESP32
firmware with Wi-Fi, has the LCD, and `simulation/wokwi/diagram.json` lets
anyone reproduce the circuit in thirty seconds.

Keep Tinkercad as a backup and as a second screenshot. If your college
specifically requires Tinkercad, submit that as primary and mention that the
Wokwi version additionally verifies the real machine code.

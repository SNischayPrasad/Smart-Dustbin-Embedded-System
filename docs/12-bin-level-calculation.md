# 12. Bin Level Calculation

## The idea in one sentence

A sensor cannot see the rubbish, so it measures the **empty air above** it and
the firmware subtracts that from the known height of the bin - and because
rubbish is never flat, **two** sensors do this from opposite diagonals and
their readings are averaged.

```
        [ ultrasonic sensor ]   <- fixed under the lid, pointing DOWN
              |     ^
              |     |  measuredDistance   (what the sensor returns)
              |     v
        ~~~~~~~~~~~~~~~~~~~~~   <- top of the rubbish
              |     ^
              |     |  fillLevel = BIN_HEIGHT - measuredDistance
              |     v
        ____________________    <- floor of the bin
```

## The formulas

```
fillLevel   = BIN_HEIGHT_CM - measuredDistance
fillPercent = (fillLevel / BIN_HEIGHT_CM) x 100
```

Combined into one line, which is what the code actually does:

```c
fillPercent = ((BIN_HEIGHT_CM - measuredDistance) / BIN_HEIGHT_CM) * 100.0;
```

It is a linear map from distance to percentage, inverted: **big distance means
empty, small distance means full.**

---

## Worked examples (BIN_HEIGHT_CM = 30)

| Condition | Measured distance | Fill level | Calculation | Fill % | Status |
|---|---|---|---|---|---|
| **Empty** | 30.0 cm | 0.0 cm | (30 - 30) / 30 x 100 | **0 %** | OK |
| 10 % | 27.0 cm | 3.0 cm | (30 - 27) / 30 x 100 | **10 %** | OK |
| **25 % full** | 22.5 cm | 7.5 cm | (30 - 22.5) / 30 x 100 | **25 %** | OK |
| **50 % full** | 15.0 cm | 15.0 cm | (30 - 15) / 30 x 100 | **50 %** | OK |
| 60 % | 12.0 cm | 18.0 cm | (30 - 12) / 30 x 100 | **60 %** | OK |
| **75 % full** | 7.5 cm | 22.5 cm | (30 - 7.5) / 30 x 100 | **75 %** | WARNING |
| 80 % | 6.0 cm | 24.0 cm | (30 - 6) / 30 x 100 | **80 %** | WARNING |
| **90 % full** | 3.0 cm | 27.0 cm | (30 - 3) / 30 x 100 | **90 %** | FULL |
| 95 % | 1.5 cm | 28.5 cm | clamped, below the dead zone | **95 %** | FULL |
| **Completely full** | 0.0 cm | 30.0 cm | (30 - 0) / 30 x 100 | **100 %** | FULL |

Step by step for the 50 % row:

```
measuredDistance = 15.0 cm
fillLevel        = 30.0 - 15.0 = 15.0 cm
fillPercent      = (15.0 / 30.0) x 100
                 = 0.5 x 100
                 = 50 %
```

---

## Going the other way

To simulate a target percentage - which is what the Wokwi sliders and the
dashboard buttons do - invert the formula:

```
measuredDistance = BIN_HEIGHT_CM x (1 - fillPercent / 100)
```

| Target fill | Set the sensor distance to |
|---|---|
| 0 % | 30.0 cm |
| 25 % | 22.5 cm |
| 50 % | 15.0 cm |
| 75 % | 7.5 cm |
| 90 % | 3.0 cm |
| 100 % | 0.0 cm |

Keep this table beside you while capturing simulation screenshots.

---

## Clamping, and why it matters

Two real cases break the raw formula:

**Case 1 - the reading is larger than the bin.** The sensor sees past the bin
through a gap, or the echo bounces off the floor of the room and returns 85 cm.
Without clamping, `(30 - 85) / 30 x 100 = -183 %`.

**Case 2 - the reading is below the dead zone.** Rubbish is pressed right
against the sensor. The HC-SR04 cannot measure below about 2 cm and may return
something odd.

```c
if (measuredDistanceCm > BIN_HEIGHT_CM) measuredDistanceCm = BIN_HEIGHT_CM;
if (measuredDistanceCm < 0)             measuredDistanceCm = 0;
...
if (pct < 0)   pct = 0;
if (pct > 100) pct = 100;
```

Two clamps on the input and two on the output. Belt and braces, and it costs
four comparisons.

---

## Fusing the two in-bin sensors

Everything above describes **one** sensor. The bin has two, mounted on
opposite diagonals under the lid, and the firmware combines them.

### The rule

```c
fillA = calculateFillPercent(distanceA);
fillB = calculateFillPercent(distanceB);

if      (A and B both valid)  fill = (fillA + fillB) / 2;   // normal
else if (only A valid)        fill = fillA;                 // degraded
else if (only B valid)        fill = fillB;                 // degraded
else                          status = SENSOR_ERROR;        // failed

uneven = fabs(fillA - fillB) > 25.0;
```

Three behaviours fall out of those five lines:

| Situation | A | B | Fused | Flag |
|---|---|---|---|---|
| Flat load | 50 % | 50 % | **50 %** | - |
| Gentle slope | 70 % | 80 % | **75 %** | - |
| Bag piled on one side | 90 % | 10 % | **50 %** | `UNEVEN LOAD` |
| Sensor A unplugged | -- | 90 % | **90 %** | `DEGRADED 1 SENSOR` |
| Both dead | -- | -- | last value held | `SENSOR_ERROR` |

### Why this matters - the worked example

A shopper drops a large cardboard box in, and it lands under sensor A.

```
     [ A ]                              [ B ]
       |  ^                               |  ^
       |  | 3.6 cm                        |  | 25.8 cm
       |  v                               |  v
   ~~~~~~~~~~~\                            |
               \~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   ____________________________________________  floor

   fillA = (30 - 3.6)  / 30 x 100 = 88 %
   fillB = (30 - 25.8) / 30 x 100 = 14 %
   fused = (88 + 14) / 2          = 51 %
   spread= |88 - 14|              = 74  ->  UNEVEN LOAD
```

A single-sensor bin mounted where A is would have reported **88 %**, crossed
the warning threshold, and sent a collection van to a bin that is barely half
full. The fused reading says **51 %** - and separately raises a flag telling
staff the load needs levelling, which is genuinely useful information a
single sensor cannot produce at all.

You can reproduce exactly this on the admin dashboard: open the simulation
panel and press **Uneven pile (A 90 / B 10)**.

### Choosing the disagreement threshold

`LEVEL_DISAGREE_PCT` is set to **25 percentage points**.

- Too low (say 5) and every normal lumpy bag raises the flag, so the flag
  gets ignored - the same failure mode as an alarm that cries wolf.
- Too high (say 60) and a genuinely lopsided load never gets reported.
- 25 points on a 30 cm bin is a height difference of 7.5 cm between the two
  measured points, which is a real mound rather than surface texture.

### What fusion does **not** fix

Be honest about this in a viva. Two sensors sample two points; they do not
measure volume. A tall narrow spike exactly between A and B is still invisible
to both. Measuring true volume needs either a sensor array, a time-of-flight
camera, or a load cell weighing the bin - all of which cost far more than two
HC-SR04 modules. Two sensors is the point where the accuracy gained per rupee
spent stops improving sharply.

---

## Calibrating BIN_HEIGHT_CM

**This is the step people skip, and it invalidates every number afterwards.**

`BIN_HEIGHT_CM` is *not* the height printed on the bin. It is the distance
from **the face of the sensor** to **the floor of the empty bin**, which
depends on how far below the lid you mounted it.

**Procedure**

1. Empty the bin completely.
2. Upload `arduino_code/02_bin_level_module`.
3. Watch the Serial Monitor for 30 seconds and note the steady reading.
4. Put that exact number into `BIN_HEIGHT_CM`.
5. Re-upload and confirm it now reports **0 %**.
6. Place an object of known height inside - say a 15 cm box in a 30 cm bin -
   and confirm the reading is close to 50 %.

**Worked example.** The bin is 35 cm tall. The sensor is mounted 4 cm below
the rim on the underside of the lid. The empty reading comes out at 31.2 cm,
not 35. Use **31.2**.

Repeat the calibration after any mechanical change - moving the sensor even a
centimetre shifts every reading.

---

## Choosing the threshold values

| Threshold | Chosen | Reasoning |
|---|---|---|
| Warning | **75 %** | Early enough that a collection can be folded into the normal round, late enough that it does not fire constantly |
| Full | **90 %** | Rubbish is compressible and uneven, so 90 % measured is effectively full. Leaves a margin before overflow |

**Why not 100 % for full?** You would only ever get an alert once the bin has
already overflowed. The alert exists to prevent the failure, not to report it.

**Why not 50 %?** Half-full bins would be emptied constantly, which throws
away the entire saving the system exists to create.

**When to shift these numbers**

| Situation | Suggested warning / full |
|---|---|
| Hospital, clinical waste | 60 % / 80 % - overflow is unacceptable |
| Airport, very high traffic | 70 % / 85 % - the bin fills fast, so react early |
| Quiet park, weekly collection | 80 % / 95 % - trips are expensive, overflow is tolerable |
| Default public bin | **75 % / 90 %** |

Because both constants live in one configuration block, retuning an entire
fleet is a one-line change and a re-flash.

---

## Sources of error, and what is done about them

| Error source | Effect | Mitigation in the firmware |
|---|---|---|
| Uneven rubbish surface | One point is not representative | **Two sensors on opposite diagonals, averaged** |
| Reading fluctuates a few cm | Surface texture, stray reflections | Median of 3 samples per sensor |
| One sensor fails | Total blindness on a single-sensor bin | Degraded mode keeps running on the survivor |
| Both level sensors ping together | Crosstalk, nonsense readings | 12 ms gap between A and B |
| Stray reflection off a bag | One wild spike | Median discards it |
| Sensor tilted | Measures a diagonal, reads long | Mounting instructions; recalibrate |
| Lid open during measurement | Sees the ceiling or an arm | Measurement skipped while the lid is open |
| Temperature change | Speed of sound shifts ~0.6 m/s per °C | Not compensated; acceptable indoors, worth adding outdoors |
| Absorbent material | No echo returns | Timeout, last known good value, SENSOR_ERROR after repeated failures |

**How large is the temperature error?** Between 10 °C and 40 °C the speed of
sound changes by roughly 5 %. On a 30 cm bin that is about 1.5 cm, which is
about 5 percentage points of fill. Indoors it is negligible; on a street bin
in direct sun it is worth adding a DHT22 and compensating.

---

## Verifying the maths

`tests/twin.test.js` asserts every row of the worked-examples table:

```bash
node tests/twin.test.js
```

```
Bin level calculation (BIN_HEIGHT = 30 cm)
  PASS  30.0 cm -> 0%
  PASS  22.5 cm -> 25%
  PASS  15.0 cm -> 50%
  PASS  7.5 cm  -> 75%
  PASS  3.0 cm  -> 90%
  PASS  0.0 cm  -> 100%
  PASS  clamp above bin height
  PASS  clamp below zero
```

If you change `BIN_HEIGHT_CM`, change it in both the sketch and
`website/assets/js/sim.js`, then re-run the tests.

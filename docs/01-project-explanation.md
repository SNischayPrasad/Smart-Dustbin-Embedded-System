# 1. Project Explanation

## What is a Smart Dustbin?

An ordinary dustbin is a passive container. A **smart dustbin** is the same
container with three additions: it can *sense* what is happening around it and
inside it, it can *decide* what to do, and it can *act* and *report*.

Concretely, this project builds a bin that:

1. Opens its own lid when a hand comes near, so nobody touches a dirty surface.
2. Measures how full it is and expresses that as a percentage.
3. Warns loudly and visibly when it is nearly full.
4. Publishes its status so a city dashboard can plan collections.

## What problem does it solve?

Two problems, one hygienic and one economic.

**The hygiene problem.** A public bin lid is one of the dirtiest surfaces in a
building. Every person who opens it transfers whatever is on their hands to
the next person. In a hospital that is a genuine infection pathway; in a food
court it is a health inspection failure waiting to happen. Removing the touch
removes the pathway.

**The economics problem.** Waste collection is normally run on a *fixed
schedule*: a van visits every bin every day whether it needs it or not.
That is wasteful in two directions at once. Half the bins visited are nearly
empty, which burns fuel and driver hours for nothing. Meanwhile a handful of
bins in busy spots overflow long before the van is due, and the rubbish ends
up on the pavement.

Fill-level data replaces the timetable with evidence. Municipal deployments of
sensor-based collection routing typically report double-digit percentage cuts
in collection trips, because vans stop visiting bins that do not need emptying.

## How automatic lid opening works

```
Hand enters the detection zone
        |
HC-SR04 #1 sends a 40 kHz ultrasonic burst
        |
The echo returns after t microseconds
        |
Microcontroller computes  distance = t / 58.31   (cm)
        |
Is distance <= 25 cm ?
        |                        \
       yes                        no
        |                          \
Servo is driven to 90 degrees      lid stays closed
        |
Lid stays open while a hand is still seen,
plus 3 seconds after the last detection
        |
Servo returns to 0 degrees
```

The important detail is the **3 second hold that restarts on every
detection**. A naive version closes the lid on a fixed timer and catches the
fingers of anyone throwing a second item. This version treats the hold as
"three seconds since I last saw anybody", which is a very different rule.

## How waste level is detected

Two more ultrasonic sensors are fixed **inside** the bin, under the lid on
opposite diagonals, pointing straight down. They do not measure the rubbish.
They measure the **empty air above** it, and the firmware subtracts that from
the known bin height:

```
fillLevel   = binHeight - measuredDistance
fillPercent = (fillLevel / binHeight) * 100
```

An empty 30 cm bin returns roughly 30 cm, so the fill is 0 %. When the sensor
starts reading 3 cm, the rubbish is 27 cm deep and the bin is 90 % full.
Full worked examples are in `12-bin-level-calculation.md`.

Rubbish, however, is never flat. A single downward sensor sitting over a peak
reports "full" while the bin is half empty, and one over a hollow reports the
opposite. So the firmware reads **both** diagonals and averages them:

```
fillPercent = (fillA + fillB) / 2
```

That one line buys three things at once:

1. **Accuracy** - two points describe a lumpy surface far better than one.
2. **Redundancy** - if one sensor fails, the bin keeps measuring on the other
   and flags itself as degraded, instead of going blind.
3. **Diagnosis** - when A and B disagree by more than 25 points the load is
   piled to one side, reported as `UNEVEN LOAD`. That is genuinely useful
   information a single sensor cannot produce at all.

Two further details make this reliable rather than merely plausible:

- The level is **not measured while the lid is open**, because with the lid up
  the sensors see the ceiling or the arm of the user.
- Each measurement is a **median of three pings**, and A and B are fired 12 ms
  apart so they never hear each other.

## How embedded systems are used here

Every classic embedded-systems building block appears in this project, and
each one earns its place:

| Concept | Where it appears |
|---|---|
| GPIO digital output | TRIG pins, LEDs, buzzer |
| GPIO digital input | ECHO pins |
| Pulse-width timing | `pulseIn()` measuring the echo, in microseconds |
| PWM | Servo angle control on D6 |
| Timers without blocking | `millis()` scheduler and the lid state machine |
| Finite state machine | CLOSED → OPENING → OPEN → CLOSING |
| Threshold logic | 25 cm hand, 75 % warn, 90 % full |
| Sensor calibration | Measuring the true empty-bin distance |
| Signal filtering | Median-of-3 spike rejection |
| Sensor fusion | Averaging two in-bin sensors, with a disagreement flag |
| Graceful degradation | Running on one level sensor when the other fails |
| Serial communication | UART telemetry at 9600 baud |
| Fault handling | Timeouts, invalid readings, error blink pattern |
| Wireless / IoT | ESP32 variant with a REST API |

## Simple explanation (for a non-technical audience)

> The bin has three eyes that work like a bat: they send out a sound you cannot
> hear and time how long it takes to bounce back. The eye on the front notices
> your hand and tells a small motor to lift the lid, so you never touch it.
> The other two are inside, in opposite corners, looking down at the rubbish -
> the less space they see, the fuller the bin is. There are two of them
> because rubbish never lies flat: if a big box lands under one corner, a bin
> with a single eye would think it was full when it was really half empty.
> When the bin genuinely is nearly full it turns on a red light, beeps, and
> sends a message to the city so a van comes before it overflows.

## Technical explanation (for a viva or an interviewer)

> The system is built around an ATmega328P running bare-metal Arduino C++. Two
> HC-SR04 ultrasonic transducers are read by driving a 10 µs pulse on TRIG and
> timing the ECHO pulse width with `pulseIn()`, which is converted to distance
> using the speed of sound (≈343 m/s), halved for the round trip: `cm = µs /
> 58.31`.
>
> The proximity channel feeds a four-state finite state machine that drives an
> SG90 servo over PWM. States are CLOSED, OPENING, OPEN and CLOSING, with a
> re-entrant hold timer and a safety transition from CLOSING back to OPENING
> if an obstruction reappears mid-travel.
>
> The level channel uses **two** transducers on opposite diagonals inside the
> bin. Each applies median-of-three filtering and a linear transfer function
> mapping distance to fill percentage against a calibrated bin height; the two
> results are then fused by averaging, with a 25-point disagreement raising an
> uneven-load flag and a single-sensor failure degrading gracefully rather
> than faulting.
> The percentage is classified into OK / WARNING / FULL bands which drive the
> LED and buzzer policy; the buzzer uses a 200 ms-on, 1.8 s-off duty cycle
> rather than a continuous tone so that staff do not disable it.
>
> The whole program is structured as a non-blocking cooperative scheduler.
> There is no `delay()` in `loop()`; each task compares `millis()` against its
> own last-run timestamp. That keeps worst-case latency in the tens of
> milliseconds and makes it possible to add Wi-Fi, a display and a command
> parser without any of them starving the others.

## System workflow

```
Object / hand detection
        v
Ultrasonic sensor #1 (front, outside)
        v
Microcontroller (ATmega328P / ESP32)
        v
Servo motor control (PWM)
        v
Automatic lid opening
        v
Waste level detection  <-- sensors #2 and #3, INSIDE the bin
        v
Fuse A and B -> fill percentage, uneven-load check
        v
Threshold comparison (75 % / 90 %)
        v
Full-bin alert
        v
LED / buzzer / LCD / dashboard output
```

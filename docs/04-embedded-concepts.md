# 4. Embedded System Concepts Used

Each concept below is followed by **why it is used here** - which is the
question an examiner actually asks.

---

## Microcontroller

The ATmega328P on the Arduino UNO: an 8-bit AVR core at 16 MHz with 32 KB
flash, 2 KB SRAM and 1 KB EEPROM.

**Why:** the whole job is reading two digital pins with microsecond accuracy,
generating one PWM signal and driving three outputs. That needs a
microcontroller, not a microprocessor - there is no operating system, no file
system and no need for either. A bare-metal MCU boots in milliseconds, costs
almost nothing, and runs for years without maintenance.

**Why not a Raspberry Pi:** a Pi boots Linux in ~30 seconds, can corrupt its
SD card on power loss, and gives *worse* timing accuracy for the echo pulse
because the scheduler can preempt your measurement. It would be the wrong tool.

---

## GPIO (General Purpose Input/Output)

**Outputs used:** TRIG x2, LEDs x2, buzzer.
**Inputs used:** ECHO x2.

**Why:** every one of these signals is binary. A pin is either driving 5 V or
0 V, or reading whether the incoming voltage is above or below the logic
threshold. `pinMode()` selects the direction, `digitalWrite()` drives an
output, `digitalRead()` samples an input.

Getting the direction wrong is the classic beginner failure: configure ECHO as
an output and you are fighting the sensor, which reads as "distance is always
zero".

---

## Ultrasonic sensor (HC-SR04)

**Why:** it measures distance without touching anything, works in complete
darkness, ignores the colour of the target, and costs under a hundred rupees.
Range 2 cm to 4 m, resolution about 3 mm, which is far more precision than a
fill percentage needs.

**How it is read:**
1. Hold TRIG high for 10 us.
2. The module emits eight 40 kHz bursts.
3. ECHO goes high, and stays high for exactly the flight time of the sound.
4. `pulseIn()` measures that width in microseconds.
5. `distance_cm = microseconds / 58.31`

**Where 58.31 comes from:** sound travels at about 343 m/s = 0.0343 cm/us. The
pulse goes out *and* comes back, so the one-way distance is half:
`0.0343 / 2 = 0.01715` cm/us, and `1 / 0.01715 = 58.31`.

**Limitations worth knowing:** soft materials absorb ultrasound and can return
no echo; angled surfaces deflect the pulse away; two sensors firing at the
same instant hear each other. All three are handled in the firmware - the last
one by firing the two in-bin sensors 12 ms apart.

---

## IR sensor (optional alternative)

**Why you might use it:** an IR proximity module is cheaper, smaller and
faster than an ultrasonic sensor for the hand-detection job.

**Why this project does not:** IR proximity is affected by ambient light,
surface colour and reflectivity - a dark sleeve reflects far less than a pale
hand, so the trigger distance is inconsistent. It also gives you a bare
on/off, not a distance, so you cannot tune a threshold in software. For the
*level* sensor IR is unusable, because rubbish is exactly the kind of
irregular, dark, absorbent surface it handles worst.

---

## Servo motor and PWM

**Why a servo:** it moves to a *commanded angle* and holds it. A plain DC
motor would need a gearbox, an H-bridge and limit switches to do the same job.

**How PWM controls it:** a hobby servo expects a pulse every 20 ms (50 Hz).
The pulse *width* sets the angle:

| Pulse width | Angle |
|---|---|
| about 1.0 ms | 0 degrees (lid closed) |
| about 1.5 ms | 90 degrees |
| about 2.0 ms | 180 degrees |

`Servo.h` hides this: `lidServo.write(90)` generates the correct pulse train
using Timer1. Note that attaching a servo disables `analogWrite()` PWM on
pins 9 and 10 on the UNO, because the library claims that timer.

---

## Buzzer

An **active** buzzer contains its own oscillator, so `digitalWrite(pin, HIGH)`
makes a tone. A **passive** buzzer needs a square wave from `tone()`.

**Why:** an audible alert reaches a cleaner who is not looking at the bin and
not carrying a phone. It is the lowest-latency channel available.

**Why it beeps instead of screaming:** 200 ms on, 1.8 s off. A continuous
alarm in a hospital corridor gets unplugged within a day, and an alert that
has been disabled is worth nothing.

---

## LEDs

Green means normal, red means attention. Each needs a series resistor:

```
R = (5 V - 2 V) / 0.015 A = 200 ohm  ->  use the standard 220 ohm
```

**Why:** an LED is a diode, not a resistor. Without the series resistor it
draws whatever current the pin can supply, which destroys the LED, the pin, or
both.

**Why the blink rate carries meaning:** slow blink = warning, solid = full,
fast blink = sensor fault. A technician diagnoses the unit from across the
room without any tools. Real products do exactly this.

---

## LCD / OLED display

**Why I2C:** a parallel 16x2 LCD needs six data pins. The I2C backpack reduces
that to two (SDA, SCL) *and* those two are shared with any other I2C device.
On a board with 14 digital pins that difference matters.

**Implementation detail that matters:** the display is only redrawn when the
text actually changes. Re-sending 32 characters over I2C hundreds of times a
second floods the bus, makes the screen flicker and steals time from the
sensors.

---

## Timers and delay

**Why `delay()` is avoided:** `delay(3000)` blocks the CPU completely. During
those three seconds the bin cannot measure its level, blink an LED, beep, or
answer a command. Every one of those failures is invisible on a desk and
obvious in a demo.

**What is used instead:**

```c
if (now - lastRun >= INTERVAL) {
    lastRun = now;
    doTheTask();
}
```

`millis()` returns milliseconds since boot as an `unsigned long`. Because the
subtraction is done in unsigned arithmetic, this pattern keeps working
correctly when `millis()` overflows after about 49.7 days - which is exactly
why you should never write `if (millis() > lastRun + INTERVAL)`.

---

## Finite state machine

The lid is not a boolean. It has four states:

```
CLOSED --hand seen--> OPENING --travel done--> OPEN
   ^                     ^                       |
   |                     | hand returns          | no hand for 3 s
   |                     |                       v
   +---travel done---  CLOSING <-----------------+
```

**Why:** it makes the hard cases explicit. What happens if a hand appears
while the lid is closing? In a boolean implementation that is an undefined
race; in the state machine it is a single, readable transition
(CLOSING to OPENING) that documents a safety requirement.

---

## Threshold logic

| Threshold | Value | Why this value |
|---|---|---|
| Hand detection | 25 cm | Close enough to be deliberate, far enough to open before the user arrives |
| Warning | 75 % | Leaves time to schedule a collection during normal rounds |
| Full | 90 % | Alerts before overflow, but not so early that the bin is emptied half full |
| Sensor dead zone | 2 cm | Below the HC-SR04 minimum range, readings there are meaningless |
| Echo timeout | 25 ms | About 4 m of flight time; beyond that, give up rather than hang |

Every one of these lives in one configuration block, so re-tuning the whole
fleet is a one-line change.

---

## Sensor calibration

**Why it cannot be skipped:** `BIN_HEIGHT_CM` is not the height of the bin you
bought. It is the distance from the *face of the sensor* to the *floor of the
bin*, which depends on how you mounted it. Guess it and every percentage is
wrong.

**Procedure:** empty the bin, run `02_bin_level_module`, read the printed
distance, and put that number into `BIN_HEIGHT_CM`. Then place an object of
known height inside and confirm the reported percentage matches reality.

---

## Signal filtering

Three pings, take the middle value. A median beats an average here because one
wild outlier shifts an average but cannot shift a median at all - and it costs
no extra memory and introduces no lag.

**Sensor fusion is the layer above this.** Filtering cleans up *one* sensor;
fusion combines *two*. The two in-bin sensors are averaged, which turns two
point samples of a lumpy surface into a much better estimate of the whole, and
their disagreement is itself a useful signal. Full argument and worked numbers
in `docs/12-bin-level-calculation.md`.

---

## Serial communication (UART)

9600 baud, 8N1. Two lines are emitted every two seconds: a human-readable one
for the Serial Monitor and a JSON one for machines.

**Why both:** the human line is what you screenshot for your report. The JSON
line is what a gateway, a Python script or the web dashboard parses. Printing
one format and post-processing it is more fragile than simply printing both.

---

## Interrupts (optional extension)

Not used in the current firmware, and it is worth being able to say why.

**Where they would help:** attaching a rising and falling interrupt to the
ECHO pin would free the CPU during the up-to-25 ms that `pulseIn()` spends
waiting. With three sensors, a display and Wi-Fi, that starts to matter.

**Why they are not used yet:** `pulseIn()` is simpler, deterministic, and the
current loop has plenty of headroom. Introducing an ISR brings shared-variable
hazards that need `volatile` and careful reasoning - complexity that would not
buy anything at this scale. Knowing *when not* to reach for a technique is
part of the engineering.

---

## Watchdog timer (mentioned for completeness)

A production unit would enable the AVR watchdog so that a hung firmware
reboots itself instead of sitting silently dead in a street. It is deliberately
left out of the student build because a watchdog that fires during a long
`delay()` in someone's experiment is a confusing thing to debug.

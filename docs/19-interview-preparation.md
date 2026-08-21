# 19. Interview Preparation

Ten questions you will actually be asked, and answers specific enough to be
believable. Do not memorise them word for word - learn the *facts* inside them,
because the follow-up is always "why?".

---

## Q1. Explain your project.

**Answer**

> Smart Dustbin is an embedded system that does two jobs: it opens its lid
> without being touched, and it tells a central dashboard how full it is.
>
> The hardware is an ESP32 with three HC-SR04 ultrasonic sensors, an SG90
> servo, two LEDs, a buzzer and an optional I2C LCD. I chose the ESP32 over an
> Arduino UNO because it is cheaper, far faster, and has Wi-Fi built in - which
> is what lets the bin publish a REST API the city dashboard can read and send
> commands to. The same firmware also builds for an UNO, minus the networking.
> One sensor faces
> outward from the front of the bin; when it sees something within 25 cm the
> servo drives the lid to 90 degrees. The lid stays open while anybody is
> still there and closes three seconds after the last detection.
>
> The other two sensors are mounted **inside** the bin, under the lid, on
> opposite diagonals, pointing down. Each measures the empty air above the
> rubbish, which is subtracted from the calibrated bin height to give a fill
> percentage. Their readings are averaged, because rubbish is never flat - a
> single sensor over a peak would report 90 % while the bin was half empty.
> Below 75 % a green LED is on; from 75 % a red LED blinks; at 90 % the red
> goes solid and a buzzer chirps for 200 ms every two seconds.
>
> The firmware is a non-blocking cooperative scheduler - there is effectively
> no delay() in loop(). Each task keeps its own millis() timestamp, and the
> lid is a four-state machine, so the bin can measure, alert, drive the
> display, serve HTTP requests and answer serial commands all at once.
>
> On top of that I built a web layer: a public page showing live city status
> on a map, and a password-protected admin console where an operator clicks a
> bin, sees its readings and sends commands - open, close, mute, mark
> collected - plus a browser simulation of the firmware so the whole thing can
> be demonstrated with no hardware. The logic is covered by 64 automated
> tests, and all five sketches compile clean for their targets.

**Then stop and let them ask.** Do not keep talking.

---

## Q2. Why two sensors inside the bin instead of one?

This is the question your project is designed to invite. Have the numbers.

**Answer**

> Because a single point measurement of a lumpy surface is unreliable.
>
> Concretely: if a box lands under sensor A, A reads 3 cm and reports 88 %
> full, while B reads 26 cm and reports 14 %. A one-sensor bin mounted where A
> is would have declared itself full and sent a collection van to a bin that
> is roughly half empty. Averaging gives 51 %, much closer to the truth.
>
> I get two more things for free. If one sensor fails, the firmware keeps
> running on the other and flags itself degraded instead of going blind. And
> the *disagreement* is itself useful - when they differ by more than 25
> percentage points the load is piled to one side, reported as UNEVEN LOAD.
>
> The honest limitation: two sensors sample two points, they do not measure
> volume. A narrow spike exactly between them is still invisible. True volume
> needs a sensor array, a time-of-flight camera or a load cell - all far more
> expensive. Two sensors is where accuracy per rupee stops improving sharply.

---

## Q3. Why did you avoid delay()?

**Answer**

> delay() blocks the whole CPU. If the lid used delay(3000) to stay open, then
> for those three seconds the bin could not measure its level, blink an LED,
> beep, or answer a command. On a desk you would never notice; in a demo it is
> obvious.
>
> Instead every task records when it last ran and asks whether enough time has
> passed:
>
> ```c
> if (now - lastRun >= INTERVAL) { lastRun = now; doTask(); }
> ```
>
> The hand sensor runs every 60 ms, the level sensors every second, telemetry
> every two seconds, alerts every pass. That is a cooperative scheduler, and
> it is how real firmware is written.
>
> One detail worth mentioning: I write `now - lastRun >= INTERVAL`, never
> `now > lastRun + INTERVAL`. Because the arithmetic is unsigned, the first
> form keeps working when millis() wraps after about 49.7 days; the second
> breaks.

---

## Q4. How does the ultrasonic sensor actually measure distance?

**Answer**

> You pulse TRIG high for 10 microseconds. The module emits eight bursts at
> 40 kHz and drives ECHO high for exactly as long as the sound is in flight.
> pulseIn() measures that width in microseconds.
>
> Sound travels about 343 m/s, which is 0.0343 cm per microsecond. The pulse
> goes out and comes back, so the one-way distance is half of that -
> 0.01715 cm per microsecond - and 1 divided by 0.01715 is about 58.3. So
> distance_cm = microseconds / 58.31.
>
> I pass a 25 ms timeout, roughly four metres of flight time. If nothing comes
> back I return -1 rather than 0, because 0 is a plausible distance and would
> be silently misread as "something is touching the sensor". A sentinel that
> cannot occur naturally is safer.

---

## Q5. Why a state machine for the lid rather than a boolean?

**Answer**

> Because a boolean cannot express the interesting case.
>
> The lid has four states: CLOSED, OPENING, OPEN and CLOSING. OPENING and
> CLOSING exist because a servo takes about 400 ms to travel, and during that
> time the lid is neither open nor shut.
>
> The transition that justifies the design is CLOSING back to OPENING. If
> somebody puts a hand back while the lid is coming down, it re-opens
> immediately. In a boolean implementation that is an undefined race; in the
> state machine it is one readable branch documenting a safety requirement.
>
> I also refresh the hold timer on every detection rather than starting it
> once, so the countdown means "three seconds since I last saw anybody". That
> is what stops the lid closing on someone throwing in a second item.

---

## Q6. What happens if a sensor gives a bad reading?

**Answer**

> Four layers, deliberately.
>
> First, range validation: anything outside 2 to 400 cm is rejected, because
> that is outside the datasheet range.
>
> Second, a timeout: pulseIn() gives up after 25 ms rather than hanging.
>
> Third, median-of-three: each level measurement is three pings and I take the
> middle value. A median beats an average because one wild outlier shifts an
> average but cannot shift a median at all, and it adds no lag.
>
> Fourth, fusion and degradation: with two in-bin sensors, one failing does
> not stop the measurement - the bin runs on the survivor and reports
> sensors=1. Only if *both* fail does it go to SENSOR_ERROR, where it blinks
> the red LED fast at about 3 Hz and holds the last known value rather than
> publishing a wrong number. It recovers by itself when the sensor returns.
>
> The principle is that a sensor fault should be visible and honest, never
> silently converted into plausible-looking data.

---

## Q7. How did you decide the 75 % and 90 % thresholds?

**Answer**

> 90 % is the alert point because the alert exists to *prevent* overflow, not
> to report it. Waiting for 100 % means you find out after rubbish is on the
> floor, and rubbish is compressible and uneven, so 90 % measured is
> effectively full.
>
> 75 % is a warning band so a collection can be folded into a normal round
> rather than triggering a special trip.
>
> They are not universal. A hospital handling clinical waste would run tighter,
> maybe 60 and 80, because overflow is unacceptable. A quiet park on a weekly
> collection might run 80 and 95, because trips are expensive and a little
> overflow is tolerable. Both constants live in one configuration block, so
> retuning a whole fleet is a one-line change and a re-flash.

---

## Q8. What is calibration, and why does it matter here?

**Answer**

> BIN_HEIGHT_CM is not the height printed on the bin. It is the distance from
> the *face of the sensor* to the *floor of the empty bin*, which depends
> entirely on how I mounted it.
>
> For example: a 35 cm bin with the sensors 4 cm below the rim measures about
> 31 cm when empty. If I left the constant at 35, an empty bin would report
> about 11 % full and every reading after that would be wrong.
>
> So: empty the bin, run the level sketch, read the steady value, put that
> number in the constant, re-upload, confirm it reports 0 %. Then drop in an
> object of known height and check the percentage.
>
> With two sensors there is an extra check - on an empty bin A and B should
> agree within about a centimetre. If they do not, they are not mounted level
> with each other, and the firmware would report a permanent false uneven
> load. That is a mechanical fix, not a software one.

---

## Q9. How did you test this?

**Answer**

> Three layers.
>
> Unit tests: 64 automated assertions in tests/twin.test.js, run with
> `node tests/twin.test.js`. They cover the fill formula at every documented
> point, the clamping, the three status bands and their exact boundaries, all
> four lid transitions including the mid-close re-open, the fusion rules -
> averaging, the uneven flag, degraded single-sensor mode, total failure - and
> the command set. I can run them in front of you right now.
>
> Integration tests: 19 manual cases against the hardware or the simulator,
> with results recorded in data/test_results.csv.
>
> Fault injection: I unplug things. One level sensor out gives degraded mode;
> both out gives SENSOR_ERROR with a fast red blink; and the servo test
> exposed a limitation I did **not** fix - it is open loop, so the firmware
> cannot detect a jammed lid. Closing that would need a limit switch or
> current sensing.
>
> All the sketches compile clean for their targets - the ESP32 build is 75 % of
> flash and 14 % of RAM, the UNO build 51 % and 40 %.

---

## Q10. What would you do differently, or add next?

**Answer**

> Three things, in order of value.
>
> **Power.** The current design assumes mains. A street bin needs deep sleep
> between measurements and a long-range radio - LoRaWAN or NB-IoT rather than
> Wi-Fi, because street furniture has no access point nearby. That is the
> difference between a battery lasting a week and lasting a year.
>
> **Closed-loop actuation.** The servo has no position feedback. A limit
> switch or current sensing would let the firmware detect a jammed lid instead
> of assuming the command worked.
>
> **Real security on the dashboard.** The login is deliberately client-side
> for the demo, and I documented that honestly in auth.js. A real deployment
> needs server-side sessions with an HttpOnly cookie, argon2 password hashing,
> HTTPS and per-device certificates. I wrote a small Node server in server/
> that demonstrates the session half of that.
>
> If I were starting again I would also add temperature compensation from the
> beginning. The speed of sound changes about 0.6 m/s per degree, roughly 5 %
> across a 30-degree swing - negligible indoors, a real error on a bin in the
> sun.

---

## Rapid-fire technical questions

| Question | Short answer |
|---|---|
| Why 58.31? | 343 m/s = 0.0343 cm/us, halved for the round trip, then inverted |
| Microcontroller vs microprocessor? | An MCU has CPU, RAM, flash and peripherals on one chip and runs bare metal; a microprocessor needs external memory and an OS |
| Why not a Raspberry Pi? | 30-second boot, SD corruption on power loss, and worse timing accuracy because the scheduler can preempt the echo measurement |
| Why ESP32 over Arduino UNO? | Cheaper, 240 MHz vs 16 MHz, 520 KB vs 2 KB RAM, and Wi-Fi built in. Cost: 3.3 V logic, so the 5 V ECHO lines need dividers |
| Why ESP32Servo instead of Servo.h? | `Servo.h` drives AVR timers directly; the ESP32 uses the LEDC peripheral, so it needs its own library |
| What is PWM? | A square wave whose duty cycle carries the information; a servo reads pulse width - 1 ms is 0 degrees, 2 ms is 180 |
| Why 220 ohm on the LEDs? | (5 V - 2 V) / 15 mA = 200 ohm, so 220 is the nearest standard value |
| Active vs passive buzzer? | Active has its own oscillator so a plain HIGH makes a tone; passive needs tone() |
| Why I2C for the LCD? | Two pins instead of six, and the bus is shared with any other I2C device |
| What does volatile do? | Tells the compiler a variable can change outside normal flow so it must not be cached in a register - needed for variables shared with an ISR |
| Why F() in Serial.print? | It keeps the string literal in flash instead of copying it into the 2 KB of SRAM |
| How much memory does it use? | ESP32: 983 KB flash (75 %), 46 KB RAM (14 %). UNO: 16,640 B flash (51 %), 836 B RAM (40 %) |
| What is crosstalk here? | Two ultrasonic sensors firing together hear each other; fixed with a 12 ms gap between pings |
| Why median and not average? | One outlier moves an average but cannot move a median, and the median adds no lag |
| Why is the level not measured while the lid is open? | The sensors would be looking at the ceiling or at the arm of the user |
| What is a cooperative scheduler? | Tasks return quickly and are dispatched by timestamp comparison, with no preemption and no RTOS |

---

## How to handle a question you cannot answer

Say so, then show your reasoning:

> "I have not measured that. My expectation would be X, because Y - and the
> way I would check it is Z."

That is far better than a confident guess. Interviewers are testing how you
think, and admitting a gap while showing method reads as competence. Bluffing
that gets unpicked reads as the opposite.

---

## Before the interview

- [ ] Run `node tests/twin.test.js` once so you can do it live without fumbling
- [ ] Have the Wokwi project open in a tab, simulation ready to start
- [ ] Have the admin dashboard open on the simulation panel
- [ ] Know your three numbers: **75 % flash, 14 % RAM (ESP32), 64 tests passing**
- [ ] Be able to point at one thing you got wrong and fixed - it is the most
      credible thing you can say

# 13. Testing Strategy

Testing an embedded system means three different activities, and it is worth
naming them separately in a viva:

1. **Unit testing** - does the maths give the right answer?
   Automated: `node tests/twin.test.js` (88 assertions).
2. **Integration testing** - do the subsystems work together?
   The 26 manual cases below.
3. **Fault injection** - what happens when something breaks?
   Cases 12, 13, 17, 18, 22 and 26, which are the ones examiners actually
   ask about.

---

## Automated unit tests

```bash
node tests/twin.test.js
```

Covers the fill formula at every documented point, the clamping behaviour, the
three status bands and their boundaries, all four lid state transitions
including the mid-close safety re-open, the 25 cm detection boundary, the
skip-while-open rule, the full command set, and the full-bin lockdown - the
refusal latch, the crew override, the release paths, and the rule that a
sensor fault does not lock.

Expected result: **88 passed, 0 failed.**

These run against `website/assets/js/sim.js`, the JavaScript twin of the
firmware. They cannot compile the `.ino`, so they prove the *logic* is right,
not that the board behaves - which is exactly why the manual cases below
exist.

---

## Manual test cases

Record the actual result for each one in `data/test_results.csv`.

### TC-01 - No object near the dustbin

| | |
|---|---|
| **Input** | Nothing within 80 cm of sensor 1 |
| **Expected** | Lid stays `CLOSED`. Serial shows `Hand=---cm` or a large value. Servo at 0 degrees. |
| **Pass** | Lid does not move for 60 seconds |
| **Fail** | Any spontaneous lid movement, which means the threshold is too far or the sensor is aimed at a wall |

### TC-02 - Hand approaches the dustbin

| | |
|---|---|
| **Input** | Move a hand to 10 cm from sensor 1 |
| **Expected** | Within about 100 ms: `>>> Hand detected - opening lid`, state becomes `OPENING`, `Opens` increments |
| **Pass** | Detected on every one of 10 attempts, latency under 200 ms |
| **Fail** | Any missed detection, or a delay over 500 ms |

### TC-03 - Lid opens

| | |
|---|---|
| **Input** | Continuation of TC-02 |
| **Expected** | Servo travels to 90 degrees; after 400 ms the state reads `OPEN` |
| **Pass** | Lid fully open, no stalling or buzzing |
| **Fail** | Partial travel, jitter, or the board resetting - almost always a power problem |

### TC-04 - Lid closes after the delay

| | |
|---|---|
| **Input** | Remove the hand and start a stopwatch |
| **Expected** | At about 3.0 s: `<<< Area clear - closing lid`; 400 ms later the state is `CLOSED` |
| **Pass** | Closes between 2.8 s and 3.5 s after the last detection |
| **Fail** | Closes immediately (hold timer broken) or never closes (the sensor still sees something) |

### TC-05 - Empty bin

| | |
|---|---|
| **Input** | Level sensor reading about 30 cm |
| **Expected** | `Fill=0%`, `Status=OK`, green LED on, red off, buzzer silent |
| **Pass** | Fill reads 0 to 3 % |
| **Fail** | Anything above 5 %, which means `BIN_HEIGHT_CM` is not calibrated |

### TC-06 - Half-full bin

| | |
|---|---|
| **Input** | Level sensor at 15 cm |
| **Expected** | `Fill=50%`, `Status=OK`, green on |
| **Pass** | Fill reads 47 to 53 % |
| **Fail** | Outside that band - recalibrate |

### TC-07 - 75 % full (the warning boundary)

| | |
|---|---|
| **Input** | Level sensor at 7.5 cm |
| **Expected** | `Fill=75%`, `Status=WARNING`, green stays on, **red blinks at about 1 Hz**, buzzer silent |
| **Pass** | Status flips to WARNING at 75 %, not at 74 or 76 |
| **Fail** | The buzzer sounds - it must not fire until 90 % |

### TC-08 - 90 % full (the full boundary)

| | |
|---|---|
| **Input** | Level sensor at 3 cm |
| **Expected** | `Fill=90%`, `Status=FULL`, green **off**, red **solid**, buzzer chirps 200 ms roughly every 2 s |
| **Pass** | All four outputs change together at exactly 90 % |
| **Fail** | A continuous buzzer tone, or the green LED staying on |

### TC-09 - Completely full bin

| | |
|---|---|
| **Input** | Level sensor at 0 to 1 cm |
| **Expected** | `Fill=100%`, `Status=FULL`, identical alerting to TC-08 |
| **Pass** | Fill is capped at 100, never above, never negative |
| **Fail** | A value over 100 % or a negative value - the clamp is broken |

### TC-10 - Red LED activation

| | |
|---|---|
| **Input** | Sweep the level sensor slowly from 30 cm down to 0 cm |
| **Expected** | Red off below 75 %, slow blink 75 to 89 %, solid from 90 % |
| **Pass** | All three distinct behaviours are observable |
| **Fail** | The LED only has two states, or the blink also blocks the sensors |

### TC-11 - Buzzer activation

| | |
|---|---|
| **Input** | Hold the bin at 95 % for 30 seconds |
| **Expected** | About 15 chirps, each roughly 200 ms, spaced about 2 s |
| **Pass** | The duty cycle is close to 10 %; `MUTE` silences it at once, `UNMUTE` restores it |
| **Fail** | A continuous tone, or `MUTE` having no effect |

### TC-12 - Invalid sensor reading (fault injection)

| | |
|---|---|
| **Input** | Unplug the ECHO wire of **both** level sensors while it is running |
| **Expected** | `Status=SENSOR_ERROR`, `A=--% B=--%`, `sensors=0`, green off, **red blinking fast at about 3 Hz**, the `errors` counter climbing |
| **Pass** | The system stays responsive - the lid still works - and recovers on its own when the wires are reconnected |
| **Note** | Unplugging only **one** of them is TC-17, and should NOT reach this state - that is the whole point of having two |
| **Fail** | The program freezes, or a nonsense percentage is reported as if it were real |

### TC-13 - Servo not responding (fault injection)

| | |
|---|---|
| **Input** | Unplug the servo signal wire, then wave a hand |
| **Expected** | The firmware still transitions through OPENING and OPEN and still logs everything - it has no feedback from the servo, so it cannot know |
| **Pass** | No crash, and the level subsystem keeps working |
| **Note** | This exposes a real design limitation: an open-loop servo gives no position feedback. A production unit would add a limit switch or current sensing. **Say this in your viva** - naming the limitation scores better than pretending it is not there. |

### TC-14 - Rapid repeated hand detection

| | |
|---|---|
| **Input** | Wave a hand in and out of the zone as fast as you can for 20 seconds |
| **Expected** | The lid opens on the first detection and then simply **stays open**; the hold timer restarts on each detection. `Opens` increments once, not thirty times. |
| **Pass** | No oscillation, no servo chatter; the lid closes 3 s after the last wave |
| **Fail** | The servo buzzing back and forth, which means the hold timer is not being refreshed |

---

### TC-15 - Flat load, both level sensors agree

| | |
|---|---|
| **Input** | Level A and level B both at 15 cm |
| **Expected** | `A=50% B=50%`, `Fill=50%`, no uneven flag, `sensors=2` |
| **Pass** | The fused value equals both individual values |
| **Fail** | A gap larger than about 3 % between A and B on a flat surface - the sensors are not mounted level with each other |

### TC-16 - Uneven load (the reason there are two sensors)

| | |
|---|---|
| **Input** | Level A at 3 cm (a peak), level B at 27 cm (a hollow) |
| **Expected** | `A=90% B=10%`, `Fill=50%`, `UNEVEN LOAD` appears, status stays OK |
| **Pass** | The fused value is the average, **not** 90 %, and the flag is raised |
| **Fail** | The bin reports FULL - it is trusting one sensor, which is the exact fault this design removes |
| **Note** | This is the headline test. Point at it in your viva: a single-sensor bin would have dispatched a van to a half-empty bin. |

### TC-17 - One level sensor fails (degraded mode)

| | |
|---|---|
| **Input** | Unplug the ECHO wire of level sensor A while running |
| **Expected** | `A=--%`, `sensors=1`, `DEGRADED 1 SENSOR` in the telemetry, the fill percentage continues from sensor B alone |
| **Pass** | The bin keeps reporting a usable level and does **not** go to SENSOR_ERROR |
| **Fail** | The whole level subsystem stops - redundancy is not working |

### TC-18 - Both level sensors fail

| | |
|---|---|
| **Input** | Unplug both ECHO wires |
| **Expected** | `Status=SENSOR_ERROR`, red LED blinking fast, `sensors=0`, last known fill retained rather than jumping to 0 |
| **Pass** | The fault is reported honestly instead of a wrong number being published |
| **Fail** | The bin reports 0 % or 100 % as though it were a real measurement |

### TC-19 - Crosstalk between the two level sensors

| | |
|---|---|
| **Input** | Normal running, bin about half full, watch A and B for 60 s |
| **Expected** | Both readings stable within about 1 cm; no sudden simultaneous spikes |
| **Pass** | No correlated jumps, which would mean one sensor is hearing the other |
| **Fail** | Regular paired glitches - increase `SENSOR_SETTLE_MS` above 12 ms |

---

## Full-bin lockdown (TC-20 to TC-26)

These are the cases for the bug fixed in this revision: a FULL bin used to
open its lid anyway. Run them on the bench with the level sensors set by hand,
or in Wokwi by dragging the sensor sliders - the behaviour is identical.

### TC-20 - A full bin refuses a hand

| | |
|---|---|
| **Input** | Both level sensors to 3 cm (`Status=FULL`), then bring a hand to 10 cm of the front sensor |
| **Expected** | The lid **does not move**. Serial prints `### Bin FULL - lid locked until it is emptied` **once**. Telemetry gains ` \| LOCKED`, JSON shows `"locked":true,"refused":1`. Red LED stays solid. |
| **Pass** | The servo does not twitch, and `refused` increments by exactly 1 |
| **Fail** | The lid opens - the lockdown is not wired in - or `Opens` increments, which means the refusal is going down the open path |
| **Note** | This is the headline case for this feature. A bin that accepts three more bags after reporting FULL is how rubbish ends up on the pavement. |

### TC-21 - One approach is one refusal (the latch)

| | |
|---|---|
| **Input** | With the bin FULL, hold a hand at 10 cm for 10 seconds, remove it for 2 s, then present it again |
| **Expected** | `refused` goes 0 -> 1 during the first 10 s and **stays at 1**; the message prints once. On the second approach it becomes 2. |
| **Pass** | `refused` == 2 after two approaches, not 160 |
| **Fail** | The counter climbing continuously - the hand sensor polls every 60 ms, so a missing latch counts about 16 times a second and floods the serial monitor |

### TC-22 - Safety beats lockdown (fault injection)

| | |
|---|---|
| **Input** | Start with an OK bin. Wave a hand so the lid opens, remove it, and **while the lid is closing** (the 400 ms `CLOSING` window) drop both level sensors to 3 cm and put the hand back |
| **Expected** | `!!! Hand returned - re-opening` - the lid re-opens **even though the bin is now FULL** |
| **Pass** | The lid re-opens every time; it then closes and locks normally once the hand is gone |
| **Fail** | The lid continues closing onto the hand. A lid must never close on somebody's hand, whatever the fill level says - there is deliberately no lock test in the `LID_CLOSING` branch |
| **Note** | The easiest way to hit the timing is to set both level sensors to 3 cm *first*, then wave: the bin is already FULL, but the lid is only locked at `CLOSED`, so the open cycle still completes. |

### TC-23 - Crew override

| | |
|---|---|
| **Input** | With the bin locked, type `OPEN` at the serial monitor (or open `/api/command?cmd=OPEN` on the ESP32) |
| **Expected** | The lid opens and the reply names the override: `ACK: lid forced OPEN (crew override - bin is FULL)` on the UNO, `lid forced open (crew override - bin FULL)` from the ESP32 |
| **Pass** | The lid opens and the wording says "crew override", so nobody reads it as the lockdown having failed |
| **Fail** | The command is refused - the crew could not empty the bin - or the reply is the ordinary one, which hides the fact that a lock was overridden |

### TC-24 - Re-locking after AUTO

| | |
|---|---|
| **Input** | Continue from TC-23. Type `AUTO`, keep the bin full, wait for the lid to close, then present a hand |
| **Expected** | The lid closes normally (3 s hold + 400 ms travel), and the next hand is refused again with the counter incrementing |
| **Pass** | The bin re-locks by itself once the lid reaches `CLOSED` - no command needed |
| **Fail** | The bin stays unlocked after the override, which would leave a full bin open to everyone until it is emptied |

### TC-25 - Emptying releases the lock

| | |
|---|---|
| **Input** | With the bin locked and `refused` > 0, type `EMPTY`. Then repeat the test by raising both level sensors above 3 cm instead of sending the command. |
| **Expected** | Both routes clear it: `Status=OK`, `locked` false, ` \| LOCKED` disappears, and `EMPTY` also resets `refused` to 0. A hand opens the lid again. |
| **Pass** | The lid opens on the next hand in **both** cases |
| **Fail** | The bin stays locked after a real emptying - a crew that empties it without sending the command must not be punished for it. Nothing stores a lock flag; `binLocked()` is computed from the status every time, so there is nothing that can get stuck. |

### TC-26 - A sensor fault does NOT lock (the deliberate exception)

| | |
|---|---|
| **Input** | Unplug **both** level ECHO wires so `Status=SENSOR_ERROR`, then present a hand |
| **Expected** | The lid **opens normally**. `locked` is false and no refusal is printed, even though the fill level is unknown. |
| **Pass** | The bin stays usable while blind |
| **Fail** | The lid refuses - the lock is keyed to "not OK" instead of to FULL |
| **Note** | **Fail usable, not fail shut.** With both sensors dead the bin has no idea how full it is; stranding every user on a guess is worse than an occasional overfill. Being able to justify this choice is worth more in a viva than the feature itself. |

---

## Boundary value table

Boundaries are where bugs live. Test the value on each side, not just the middle.

| Parameter | Just below | At the boundary | Just above |
|---|---|---|---|
| Hand detection (25 cm) | 24.9 cm - opens | 25.0 cm - opens | 25.1 cm - stays closed |
| Warning (75 %) | 74 % - OK | 75 % - WARNING | 76 % - WARNING |
| Full (90 %) | 89 % - WARNING | 90 % - FULL | 91 % - FULL |
| Lockdown (90 %) | 89 % - lid opens | 90 % - lid refuses | 91 % - lid refuses |
| Dead zone (2 cm) | 1.9 cm - rejected | 2.0 cm - accepted | 2.1 cm - accepted |
| Max range (400 cm) | 399 cm - accepted | 400 cm - accepted | 401 cm - rejected |
| Uneven flag (25 pts) | 24 pts - no flag | 25 pts - no flag | 26 pts - flag raised |

All of these are asserted in `tests/twin.test.js`.

---

## Endurance and stability

| Test | Method | Pass criterion |
|---|---|---|
| Continuous run | Leave it powered for 24 hours | No freeze, no drift, no memory exhaustion |
| Lid cycle life | 500 open and close cycles | Servo still reaches both end positions |
| Reading stability | Log the level for 10 minutes with nothing changing | Spread under about 1 cm |
| Timer rollover | Reason about `millis()` wrapping | Unsigned subtraction keeps working past 49.7 days |

---

## Test results template

`data/test_results.csv` is pre-filled with the case IDs. Fill in the rest as
you go:

```csv
test_id,description,input,expected,actual,result,notes
TC-01,No object near bin,>80cm,Lid CLOSED,,,
TC-02,Hand approaches,10cm,Lid OPENING,,,
```

Committing this file filled in with real observations is one of the strongest
signals a reviewer can see. An empty template is worth nothing; a completed
one - including any failures you found and then fixed - is worth a great deal.

---

## How to demonstrate testing in a viva

Do not say "I tested it and it worked". Say:

> "I have three layers. Eighty-eight automated assertions cover the fill
> formula, the sensor fusion, every state transition and the full-bin
> lockdown - I can run them right now with `node tests/twin.test.js`.
> Twenty-six integration cases cover the hardware behaviour, and the results
> are committed in `data/test_results.csv`. Six of those are fault injection:
> unplug one level sensor and the bin degrades to running on the other and
> says so; unplug both and it reports SENSOR_ERROR rather than publishing a
> wrong number. Test case 16 is the one I would point at - with rubbish piled
> under one sensor, a single-sensor bin reports 88 % and dispatches a van to a
> half-empty bin, while the fused reading is 51 % plus an uneven-load flag.
> Test case 22 is the one I am proudest of: a full bin refuses to open, but if
> the bin goes full while the lid is already coming down and a hand returns,
> the lid still re-opens - safety beats lockdown. And case 26 is a decision
> rather than a bug: a bin whose level sensors have both failed does **not**
> lock, because stranding every user on a guess is worse than an occasional
> overfill. Test case 13 also documents a limitation I did **not** fix: the
> servo is open-loop, so the firmware cannot detect a jammed lid. Closing that
> would need a limit switch."

That answer demonstrates method, evidence and self-awareness in three
sentences.

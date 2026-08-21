# 6. Project Architecture

## 1. System block diagram

```
+---------------------------------------------------------------------------+
|                              SMART DUSTBIN NODE                           |
|                                                                           |
|   INPUTS                     PROCESSING                    OUTPUTS        |
|   ------                     ----------                    -------        |
|                                                                           |
|  +--------------+                                                         |
|  | HC-SR04 #1   |--TRIG D2-->+---------------------+                      |
|  | hand, OUTSIDE|<-ECHO D3---|                     |--PWM D6---> +-----+  |
|  +--------------+            |                     |             |Servo|  |
|                              |    ATmega328P       |             +-----+  |
|  +--------------+            |                     |                      |
|  | HC-SR04 #2   |--TRIG D4-->|  - read 3 sensors   |--D7-------> +------+ |
|  | level A, IN  |<-ECHO D5---|  - median filter    |             |Buzzer| |
|  +--------------+            |  - FUSE A and B     |             +------+ |
|                              |  - lid FSM          |                      |
|  +--------------+            |  - fill maths       |--D10------> (green)  |
|  | HC-SR04 #3   |--TRIG D8-->|  - thresholds       |--D12------> (red)    |
|  | level B, IN  |<-ECHO D9---|  - alert policy     |                      |
|  +--------------+            |  - telemetry        |--A4/A5----> +-----+  |
|                              +---------+-----------+             | LCD |  |
|  +--------------+                      |                         +-----+  |
|  | Serial cmds  |--RX--------->        |                                  |
|  | from the PC  |<-TX----------        |                                  |
|  +--------------+                      |                                  |
+----------------------------------------|----------------------------------+
                                         | UART 9600 or Wi-Fi (ESP32)
                                         v
                          +------------------------------+
                          |  Admin dashboard (website/)  |
                          |  map, control, alerts, log   |
                          +------------------------------+
```

### Why two sensors inside the bin

```
     [ sensor A ]                        [ sensor B ]
          |  ^                                |  ^
          |  | distA = 3 cm                   |  | distB = 27 cm
          |  v                                |  v
      ~~~~~~~~~~~~\                            |
                   \~~~~~~~~~~~~~~~~~~~~~~~~~~~~
          ^ a peak                    a hollow ^
      ____|____________________________________|____   bin floor

   Sensor A alone says  90% -> "FULL, send a van"     (wrong)
   Sensor B alone says  10% -> "practically empty"    (wrong)
   Fused  (A+B)/2 says  50% -> correct, plus an UNEVEN LOAD flag
```

## 2. Software architecture

```
                            loop()   -- runs thousands of times per second
                              |
        +---------------------+----------------------+------------------+
        |                     |                      |                  |
  every 60 ms          every 1000 ms           every 2000 ms        every pass
        |                     |                      |                  |
  taskHandDetection     taskBinLevel            taskTelemetry      taskAlerts
        |                     |                      |             taskDisplay
        v                     v                      v                  |
  read sensor 1        read A then B (median)   print human line        v
  compare 25 cm        skip if lid is open      print JSON line    drive LEDs,
        |              fuse: (fillA+fillB)/2                       buzzer, LCD
        v              classify OK/WARN/FULL
  lid state machine
        |
        v
  servo.write(angle)
```

Nothing in this diagram blocks. Every box returns immediately, which is why
they can all appear to run at once on a single-core 16 MHz chip.

## 3. Input / output table

### Inputs

| Signal | Source | Type | Range | Sampled every | Used for |
|---|---|---|---|---|---|
| Hand distance | HC-SR04 #1 ECHO (GPIO18) | Pulse width, us | 2 - 400 cm | 60 ms | Lid trigger |
| Waste distance A | HC-SR04 #2 ECHO (GPIO23) | Pulse width, us | 2 - 400 cm | 1000 ms | Fill, left diagonal |
| Waste distance B | HC-SR04 #3 ECHO (GPIO33) | Pulse width, us | 2 - 400 cm | 1000 ms | Fill, right diagonal |
| Operator command | UART RX or HTTP GET | ASCII text | 8 commands | on arrival | Manual override |

### Outputs

| Signal | Destination | Type | States | Driven by |
|---|---|---|---|---|
| Servo angle | SG90 (GPIO13) | PWM 50 Hz | 0 or 90 degrees | Lid state machine |
| Green LED | GPIO26 | Digital | on / off | Bin status |
| Red LED | GPIO27 | Digital | off / slow blink / solid / fast blink | Bin status |
| Buzzer | GPIO25 | Digital | silent / 200 ms chirp per 2 s | Bin status and mute flag |
| LCD text | GPIO21, GPIO22 | I2C | 2 lines of 16 chars | Lid state and fill |
| Telemetry | UART TX + HTTP | ASCII + JSON | 2 lines per 2 s | Every subsystem |

## 4. Sensor threshold table

| Parameter | Symbol in code | Value | Meaning |
|---|---|---|---|
| Bin height | `BIN_HEIGHT_CM` | 30.0 cm | Sensor face to empty floor. **Calibrate this.** |
| Hand trigger | `HAND_DETECT_CM` | 25.0 cm | Closer than this opens the lid |
| Sensor dead zone | `SENSOR_DEAD_ZONE_CM` | 2.0 cm | Below this the HC-SR04 cannot measure |
| Max valid range | `MAX_VALID_CM` | 400.0 cm | Datasheet maximum |
| Warning band | `LEVEL_WARN_PERCENT` | 75 % | Schedule a pickup |
| Full band | `LEVEL_FULL_PERCENT` | 90 % | Collect now, buzzer on |
| Lid hold | `LID_OPEN_HOLD_MS` | 3000 ms | Time after the last detection |
| Servo travel | `LID_TRAVEL_MS` | 400 ms | Mechanical sweep time |
| Echo timeout | `ULTRASONIC_TIMEOUT_US` | 25000 us | Give up after about 4 m |
| Median samples | `MEDIAN_SAMPLES` | 3 | Spike rejection window |
| Uneven-load gap | `LEVEL_DISAGREE_PCT` | 25 % | A vs B difference that flags a tilted load |
| Inter-ping gap | `SENSOR_SETTLE_MS` | 12 ms | Stops A and B hearing each other |

## 5. State and status tables

### Lid states

| State | Meaning | Entered when | Leaves when |
|---|---|---|---|
| `CLOSED` | Resting | Travel finishes from CLOSING | A hand is detected |
| `OPENING` | Servo sweeping up | A hand is detected | 400 ms elapses |
| `OPEN` | Fully open | Travel finishes | 3 s since the last detection |
| `CLOSING` | Servo sweeping down | Hold expires | 400 ms elapses, or a hand returns |

### Bin status bands

| Status | Fill range | Green | Red | Buzzer | Map colour |
|---|---|---|---|---|---|
| `OK` | 0 - 74 % | on | off | silent | green |
| `WARNING` | 75 - 89 % | on | slow blink | silent | amber |
| `FULL` | 90 - 100 % | off | solid | chirp every 2 s | red |
| `SENSOR_ERROR` | no valid reading | off | fast blink | silent | grey |

## 6. Control flow, end to end

```
POWER ON
   |
   +-> configure pins, attach the servo, init the LCD
   +-> power-on self test (LEDs, buzzer, servo sweep)
   +-> print the configuration banner
   |
LOOP FOREVER
   |
   +-- Is a serial command waiting? ------> parse it and apply it
   |
   +-- 60 ms elapsed? -------> ping sensor 1
   |                           distance <= 25 cm ?
   |                             |            |
   |                            yes           no
   |                             |            |
   |                       refresh hold    (nothing)
   |                             |
   |                       advance the lid state machine
   |                             |
   |                       servo.write(angle) on a state change
   |
   +-- 1000 ms elapsed? -----> lid open? --yes--> skip, reading is invalid
   |                                |
   |                                no
   |                                |
   |                           3 pings, take the median
   |                                |
   |                           valid? --no--> errorCount++, SENSOR_ERROR
   |                                |
   |                               yes
   |                                |
   |                           fill = (H - d) / H * 100
   |                           classify into OK / WARNING / FULL
   |
   +-- 2000 ms elapsed? -----> print the human line and the JSON line
   |
   +-- every pass -----------> drive the LEDs and the buzzer from the status
   +-- every pass -----------> refresh the LCD only if the text changed
   |
   +-- back to the top
```

## 7. Fleet architecture (the website layer)

```
   BIN-001        BIN-002        BIN-003   ...   BIN-016
      |              |              |               |
      +--------------+--------------+---------------+
                          |
                 Wi-Fi / LoRa / GSM
                          |
                +---------------------+
                |   Backend service   |   server/server.js
                |   - session auth    |   (or a cloud broker)
                |   - fleet state     |
                |   - command relay   |
                +----------+----------+
                           |
         +-----------------+------------------+
         |                                    |
  Public site (index.html)          Admin console (admin.html)
  read-only city status             login required, full control
```

The bin firmware does not care which of these is listening. It publishes its
status and accepts commands; everything above it is replaceable.

## 8. Data model

One bin record, as it travels from the device to the dashboard:

```json
{
  "id":       "BIN-001",
  "name":     "Charminar Plaza",
  "zone":     "Old City",
  "category": "Public Square",
  "lat":      17.3616,
  "lng":      78.4747,
  "fill":     34,
  "capacity": 120,
  "lid":      "CLOSED",
  "status":   "ok",
  "muted":    false,
  "manual":   false,
  "online":   true,
  "battery":  72,
  "rssi":     -45,
  "opens":    118,
  "firmware": "1.0.0",
  "lastSeen": 1787243774627
}
```

The device itself only produces the middle block - `fill`, `lid`, `status`,
`opens`, `errors`, `uptime`. Identity and location are added by the backend,
because a bin should not have to know or care where it was installed.

## 9. Design decisions worth defending

| Decision | Alternative rejected | Reason |
|---|---|---|
| Two sensors | One sensor doing both jobs | They point in opposite directions and need different sample rates |
| State machine for the lid | A boolean plus `delay()` | Makes the mid-close re-open case explicit rather than a race |
| Cooperative scheduler | An RTOS | An RTOS costs memory and complexity that four tasks do not justify |
| Median of 3 | A moving average | A median rejects outliers outright and adds no lag |
| Skip level while open | Measure continuously | With the lid up the sensor cannot see the rubbish |
| Chirp, not a siren | Continuous alarm | A continuous alarm gets disabled by staff, so it protects nothing |
| Thresholds in one block | Constants inline | A city retunes the fleet by editing one place |
| JSON on the wire | A custom binary format | Any tool can parse it, and the bandwidth cost is irrelevant here |

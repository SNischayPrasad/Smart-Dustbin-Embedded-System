/**************************************************************************
 *  SMART DUSTBIN - TINKERCAD CIRCUITS VERSION
 *  Same firmware as 04_smart_dustbin_complete, with the I2C LCD disabled
 *  because Tinkercad has no I2C display component.
 *  Arduino UNO  |  Firmware v2.0.0-tinkercad
 *  ------------------------------------------------------------------------
 *  THREE ULTRASONIC SENSORS
 *    #1 HAND    - on the front face, looking outward.
 *                 A hand within 25 cm makes the servo lift the lid.
 *    #2 LEVEL A - INSIDE the bin, under the lid, front-left diagonal.
 *    #3 LEVEL B - INSIDE the bin, under the lid, rear-right diagonal.
 *
 *  WHY TWO SENSORS INSIDE THE BIN?
 *    Rubbish never forms a flat surface. A single downward sensor sitting
 *    over a peak reports "full" while the bin is half empty; one sitting
 *    over a hollow reports the opposite. Two sensors on opposite diagonals
 *    give three things at once:
 *      1. ACCURACY   - averaging two points is far closer to the real
 *                      volume than trusting one point.
 *      2. REDUNDANCY - if one sensor dies the bin keeps working on the
 *                      other, in a clearly flagged degraded mode.
 *      3. DIAGNOSIS  - a large disagreement between A and B means the load
 *                      is piled to one side, which is worth reporting.
 *
 *  DESIGN NOTE - WHY THERE IS ALMOST NO delay() IN loop()
 *    delay() freezes the whole CPU. If the lid used delay(3000) the bin
 *    could not measure its level, blink, beep or answer commands during
 *    those 3 seconds. Instead every activity keeps its own millis()
 *    timestamp and asks "has enough time passed yet?". That structure is
 *    a cooperative scheduler with state machines, and it is how real
 *    embedded products are written.
 *
 *  WIRING SUMMARY (full table in circuit_diagram/connections.md)
 *    HC-SR04 #1 (hand)     TRIG D2   ECHO D3   VCC 5V  GND GND
 *    HC-SR04 #2 (level A)  TRIG D4   ECHO D5   VCC 5V  GND GND
 *    HC-SR04 #3 (level B)  TRIG D8   ECHO D9   VCC 5V  GND GND
 *    Servo SG90            SIGNAL D6  V+ 5V    GND GND
 *    Buzzer                D7 to +          - to GND
 *    Green LED             D10 - 220R - LED - GND
 *    Red LED               D12 - 220R - LED - GND

 *
 *  SERIAL COMMANDS (Serial Monitor at 9600 baud, line ending = Newline)
 *    OPEN    force the lid open      CLOSE   force the lid shut
 *    MUTE    silence the buzzer      UNMUTE  allow the buzzer
 *    EMPTY   mark the bin collected  STATUS  print a full report
 *    AUTO    leave manual override   HELP    list the commands
 **************************************************************************/

/* ======================================================================
 *  BUILD OPTIONS
 *  Comment the next line out if you do NOT have an I2C LCD. Everything
 *  else keeps working - the display code simply disappears.
 * ==================================================================== */
/* Tinkercad has no I2C LCD component, so the display is disabled here.
   Everything else is identical to 04_smart_dustbin_complete.ino          */
//#define USE_LCD

#include <Servo.h>
#ifdef USE_LCD
  #include <Wire.h>
  #include <LiquidCrystal_I2C.h>
  LiquidCrystal_I2C lcd(0x27, 16, 2);   /* try 0x3F if the screen is blank */
#endif

/* ======================================================================
 *  1. PIN MAP
 * ==================================================================== */
const uint8_t PIN_TRIG_HAND    = 2;
const uint8_t PIN_ECHO_HAND    = 3;
const uint8_t PIN_TRIG_LEVEL_A = 4;
const uint8_t PIN_ECHO_LEVEL_A = 5;
const uint8_t PIN_SERVO        = 6;
const uint8_t PIN_BUZZER       = 7;
const uint8_t PIN_TRIG_LEVEL_B = 8;
const uint8_t PIN_ECHO_LEVEL_B = 9;
const uint8_t PIN_LED_GREEN    = 10;
const uint8_t PIN_LED_RED      = 12;

/* ======================================================================
 *  2. CONFIGURATION - every tunable number lives here
 * ==================================================================== */
const char*   DEVICE_ID  = "BIN-001";
const char*   FIRMWARE_V = "2.0.0-tc";

const float   BIN_HEIGHT_CM      = 30.0;   /* sensor face to empty floor */
const float   HAND_DETECT_CM     = 25.0;   /* closer than this, open     */
const float   LEVEL_WARN_PERCENT = 75.0;
const float   LEVEL_FULL_PERCENT = 90.0;
const float   LEVEL_DISAGREE_PCT = 25.0;   /* A vs B gap = uneven load   */

const int     ANGLE_CLOSED = 0;
const int     ANGLE_OPEN   = 90;

const unsigned long LID_OPEN_HOLD_MS = 3000;
const unsigned long LID_TRAVEL_MS    = 400;
const unsigned long LID_SAMPLE_MS    = 60;
const unsigned long LEVEL_SAMPLE_MS  = 1000;
const unsigned long TELEMETRY_MS     = 2000;
const unsigned long BEEP_ON_MS       = 200;
const unsigned long BEEP_OFF_MS      = 1800;
const unsigned long SENSOR_SETTLE_MS = 12;   /* anti-crosstalk gap       */

const unsigned long ECHO_TIMEOUT_US  = 25000;
const float         INVALID          = -1.0;

/* ======================================================================
 *  3. TYPES
 * ==================================================================== */
enum LidState  { LID_CLOSED, LID_OPENING, LID_OPEN, LID_CLOSING };
enum BinStatus { BIN_OK, BIN_WARNING, BIN_FULL, BIN_ERROR };

/* ======================================================================
 *  4. GLOBAL STATE
 * ==================================================================== */
Servo lidServo;

LidState  lidState  = LID_CLOSED;
BinStatus binStatus = BIN_OK;

float handDistance = INVALID;
float distA        = INVALID;   /* raw cm from level sensor A */
float distB        = INVALID;   /* raw cm from level sensor B */
float fillA        = INVALID;   /* percentage seen by A       */
float fillB        = INVALID;   /* percentage seen by B       */
float fillPercent  = 0.0;       /* the fused value            */
float fillSpread   = 0.0;       /* |fillA - fillB|            */
bool  unevenLoad   = false;
uint8_t validSensors = 0;       /* 2 healthy, 1 degraded, 0 failed */

unsigned long stateEnteredAt = 0;
unsigned long lastSeenHandAt = 0;
unsigned int  openCount      = 0;
unsigned int  errorCount     = 0;

bool          buzzerEnabled  = true;
bool          buzzerOn       = false;
unsigned long buzzerChanged  = 0;
bool          blinkOn        = false;
unsigned long blinkChanged   = 0;
bool          manualOverride = false;

unsigned long tLid = 0, tLevel = 0, tTelem = 0;

/* ======================================================================
 *  4b. FUNCTION PROTOTYPES
 *  Declared explicitly because some take our own enum types. Good C
 *  practice, and it removes any dependency on the automatic prototype
 *  generator of the Arduino IDE.
 * ==================================================================== */
void        taskHandDetection(unsigned long now);
void        taskBinLevel(void);
void        taskAlerts(unsigned long now);
void        taskDisplay(void);
void        taskTelemetry(unsigned long now);
void        updateLidStateMachine(bool handDetected, unsigned long now);
void        enterLidState(LidState s, unsigned long now);
bool        lidIsOpen(void);
const char* lidStateName(void);
float       calculateFillPercent(float measuredDistanceCm);
void        fuseLevelSensors(float dA, float dB);
const char* binStatusName(void);
bool        blinkPhase(unsigned long now, unsigned long periodMs);
void        printBar(float percent);
float       readDistanceCm(uint8_t trigPin, uint8_t echoPin);
float       readDistanceMedian(uint8_t trigPin, uint8_t echoPin);
void        handleSerialCommands(void);
void        banner(void);
void        selfTest(void);

/* ======================================================================
 *  5. SETUP - runs once at power-on
 * ==================================================================== */
void setup() {
  Serial.begin(9600);

  pinMode(PIN_TRIG_HAND,    OUTPUT);  pinMode(PIN_ECHO_HAND,    INPUT);
  pinMode(PIN_TRIG_LEVEL_A, OUTPUT);  pinMode(PIN_ECHO_LEVEL_A, INPUT);
  pinMode(PIN_TRIG_LEVEL_B, OUTPUT);  pinMode(PIN_ECHO_LEVEL_B, INPUT);
  pinMode(PIN_BUZZER,       OUTPUT);
  pinMode(PIN_LED_GREEN,    OUTPUT);
  pinMode(PIN_LED_RED,      OUTPUT);

  lidServo.attach(PIN_SERVO);
  lidServo.write(ANGLE_CLOSED);      /* boot into a known safe state */

#ifdef USE_LCD
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0); lcd.print("Smart Dustbin");
  lcd.setCursor(0, 1); lcd.print(DEVICE_ID);
#endif

  banner();
  selfTest();

  stateEnteredAt = millis();
  Serial.println(F("System running. Type HELP for commands."));
  Serial.println();
}

/* ======================================================================
 *  6. LOOP - the cooperative scheduler
 * ==================================================================== */
void loop() {
  unsigned long now = millis();

  handleSerialCommands();

  if (now - tLid   >= LID_SAMPLE_MS)   { tLid   = now; taskHandDetection(now); }
  if (now - tLevel >= LEVEL_SAMPLE_MS) { tLevel = now; taskBinLevel();         }
  if (now - tTelem >= TELEMETRY_MS)    { tTelem = now; taskTelemetry(now);     }

  taskAlerts(now);      /* cheap, must react instantly */
  taskDisplay();
}

/* ======================================================================
 *  TASK 1 - HAND DETECTION AND LID CONTROL
 * ==================================================================== */
void taskHandDetection(unsigned long now) {
  handDistance = readDistanceCm(PIN_TRIG_HAND, PIN_ECHO_HAND);

  bool handDetected = (handDistance != INVALID) &&
                      (handDistance <= HAND_DETECT_CM);

  if (manualOverride) return;    /* the operator is in control right now */

  updateLidStateMachine(handDetected, now);
}

/**************************************************************************
 *  updateLidStateMachine()
 *
 *      +----------+  hand seen   +-----------+  travel done  +--------+
 *      |  CLOSED  |------------->|  OPENING  |-------------->|  OPEN  |
 *      +----------+              +-----------+               +--------+
 *           ^                          ^                          |
 *           | travel done              | hand returns             | no hand
 *           |                          |                          | for 3 s
 *      +----------+                    |                          |
 *      | CLOSING  |<-------------------+--------------------------+
 *      +----------+
 *
 *  The CLOSING to OPENING edge is a safety feature: if somebody puts a
 *  hand back while the lid is coming down, it opens again immediately.
 **************************************************************************/
void updateLidStateMachine(bool handDetected, unsigned long now) {

  if (handDetected) lastSeenHandAt = now;

  switch (lidState) {

    case LID_CLOSED:
      if (handDetected) {
        lidServo.write(ANGLE_OPEN);
        openCount++;
        enterLidState(LID_OPENING, now);
        Serial.println(F(">>> Hand detected - opening lid"));
      }
      break;

    case LID_OPENING:
      if (now - stateEnteredAt >= LID_TRAVEL_MS) enterLidState(LID_OPEN, now);
      break;

    case LID_OPEN:
      if (now - lastSeenHandAt >= LID_OPEN_HOLD_MS) {
        lidServo.write(ANGLE_CLOSED);
        enterLidState(LID_CLOSING, now);
        Serial.println(F("<<< Area clear - closing lid"));
      }
      break;

    case LID_CLOSING:
      if (handDetected) {                       /* safety re-open */
        lidServo.write(ANGLE_OPEN);
        enterLidState(LID_OPENING, now);
        Serial.println(F("!!! Hand returned - re-opening"));
      } else if (now - stateEnteredAt >= LID_TRAVEL_MS) {
        enterLidState(LID_CLOSED, now);
      }
      break;
  }
}

void enterLidState(LidState s, unsigned long now) {
  lidState       = s;
  stateEnteredAt = now;
}

bool lidIsOpen() { return (lidState == LID_OPEN || lidState == LID_OPENING); }

const char* lidStateName() {
  switch (lidState) {
    case LID_CLOSED:  return "CLOSED";
    case LID_OPENING: return "OPENING";
    case LID_OPEN:    return "OPEN";
    case LID_CLOSING: return "CLOSING";
  }
  return "UNKNOWN";
}

/* ======================================================================
 *  TASK 2 - WASTE LEVEL FROM THE TWO IN-BIN SENSORS
 *  Skipped while the lid is open, because with the lid up both sensors
 *  see the sky or the arm of the user instead of the rubbish.
 * ==================================================================== */
void taskBinLevel() {
  if (lidIsOpen()) return;

  distA = readDistanceMedian(PIN_TRIG_LEVEL_A, PIN_ECHO_LEVEL_A);
  delay(SENSOR_SETTLE_MS);       /* let A's echoes die before B fires */
  distB = readDistanceMedian(PIN_TRIG_LEVEL_B, PIN_ECHO_LEVEL_B);

  fuseLevelSensors(distA, distB);

  if      (validSensors == 0)                 { errorCount++; binStatus = BIN_ERROR; }
  else if (fillPercent >= LEVEL_FULL_PERCENT) binStatus = BIN_FULL;
  else if (fillPercent >= LEVEL_WARN_PERCENT) binStatus = BIN_WARNING;
  else                                        binStatus = BIN_OK;
}

/**************************************************************************
 *  calculateFillPercent()   - one sensor, pure maths
 *      fillLevel   = BIN_HEIGHT - measuredDistance
 *      fillPercent = fillLevel / BIN_HEIGHT * 100
 *
 *  Worked examples with BIN_HEIGHT_CM = 30:
 *      30.0 cm ->   0 %      22.5 cm ->  25 %
 *      15.0 cm ->  50 %       7.5 cm ->  75 %
 *       3.0 cm ->  90 %       0.0 cm -> 100 %
 **************************************************************************/
float calculateFillPercent(float measuredDistanceCm) {
  /* Any negative value is the "no echo" sentinel. A real distance can
     never be negative, so there is nothing to clamp - it is missing data. */
  if (measuredDistanceCm < 0) return INVALID;

  if (measuredDistanceCm > BIN_HEIGHT_CM) measuredDistanceCm = BIN_HEIGHT_CM;

  float fillLevel = BIN_HEIGHT_CM - measuredDistanceCm;
  float pct       = (fillLevel / BIN_HEIGHT_CM) * 100.0;

  if (pct < 0)   pct = 0;
  if (pct > 100) pct = 100;
  return pct;
}

/**************************************************************************
 *  fuseLevelSensors()
 *  Combines the two in-bin readings into one trustworthy answer.
 *
 *    Both valid -> average them, and flag a large disagreement as an
 *                  uneven load.
 *    One valid  -> use it and carry on. The bin is degraded, not dead:
 *                  half a measurement beats no measurement at all.
 *    None valid -> report failure rather than inventing a number.
 **************************************************************************/
void fuseLevelSensors(float dA, float dB) {
  fillA = calculateFillPercent(dA);
  fillB = calculateFillPercent(dB);

  bool aOk = (fillA != INVALID);
  bool bOk = (fillB != INVALID);

  fillSpread = 0.0;
  unevenLoad = false;

  if (aOk && bOk) {
    validSensors = 2;
    fillPercent  = (fillA + fillB) / 2.0;
    fillSpread   = fabs(fillA - fillB);
    unevenLoad   = (fillSpread > LEVEL_DISAGREE_PCT);

  } else if (aOk) {
    validSensors = 1;
    fillPercent  = fillA;

  } else if (bOk) {
    validSensors = 1;
    fillPercent  = fillB;

  } else {
    validSensors = 0;
    /* keep the last known fillPercent rather than jumping to zero */
  }
}

const char* binStatusName() {
  switch (binStatus) {
    case BIN_OK:      return "OK";
    case BIN_WARNING: return "WARNING";
    case BIN_FULL:    return "FULL";
    case BIN_ERROR:   return "SENSOR_ERROR";
  }
  return "UNKNOWN";
}

/* ======================================================================
 *  TASK 3 - ALERTS
 *   0-74 %    green ON,  red OFF,        buzzer silent
 *   75-89 %   green ON,  red slow blink, buzzer silent
 *   90-100 %  green OFF, red solid,      chirp 200 ms every 2 s
 *   error     green OFF, red fast blink, buzzer silent
 * ==================================================================== */
void taskAlerts(unsigned long now) {
  switch (binStatus) {

    case BIN_OK:
      digitalWrite(PIN_LED_GREEN, HIGH);
      digitalWrite(PIN_LED_RED,   LOW);
      digitalWrite(PIN_BUZZER,    LOW);
      buzzerOn = false;
      break;

    case BIN_WARNING:
      digitalWrite(PIN_LED_GREEN, HIGH);
      digitalWrite(PIN_LED_RED,   blinkPhase(now, 500) ? HIGH : LOW);
      digitalWrite(PIN_BUZZER,    LOW);
      buzzerOn = false;
      break;

    case BIN_FULL:
      digitalWrite(PIN_LED_GREEN, LOW);
      digitalWrite(PIN_LED_RED,   HIGH);
      if (!buzzerEnabled) {
        digitalWrite(PIN_BUZZER, LOW);
        buzzerOn = false;
      } else if (buzzerOn && (now - buzzerChanged >= BEEP_ON_MS)) {
        buzzerOn = false; digitalWrite(PIN_BUZZER, LOW);  buzzerChanged = now;
      } else if (!buzzerOn && (now - buzzerChanged >= BEEP_OFF_MS)) {
        buzzerOn = true;  digitalWrite(PIN_BUZZER, HIGH); buzzerChanged = now;
      }
      break;

    case BIN_ERROR:
      digitalWrite(PIN_LED_GREEN, LOW);
      digitalWrite(PIN_LED_RED,   blinkPhase(now, 150) ? HIGH : LOW);
      digitalWrite(PIN_BUZZER,    LOW);
      buzzerOn = false;
      break;
  }
}

bool blinkPhase(unsigned long now, unsigned long periodMs) {
  if (now - blinkChanged >= periodMs) {
    blinkOn      = !blinkOn;
    blinkChanged = now;
  }
  return blinkOn;
}

/* ======================================================================
 *  TASK 4 - DISPLAY (only compiled when USE_LCD is defined)
 * ==================================================================== */
void taskDisplay() {
#ifdef USE_LCD
  static char line0[17] = "";
  static char line1[17] = "";
  static char prev0[17] = "";
  static char prev1[17] = "";

  snprintf(line0, sizeof(line0), "Lid:%-7s%s", lidStateName(),
           unevenLoad ? "TILT" : (validSensors == 1 ? "1SEN" : "    "));

  if (binStatus == BIN_ERROR) {
    snprintf(line1, sizeof(line1), "SENSOR ERROR    ");
  } else {
    snprintf(line1, sizeof(line1), "Fill:%3d%% %-6s",
             (int)(fillPercent + 0.5), binStatusName());
  }

  /* Redraw only on change - constant redrawing floods the I2C bus. */
  if (strcmp(line0, prev0) != 0) { lcd.setCursor(0,0); lcd.print(line0); strcpy(prev0, line0); }
  if (strcmp(line1, prev1) != 0) { lcd.setCursor(0,1); lcd.print(line1); strcpy(prev1, line1); }
#endif
}

/* ======================================================================
 *  TASK 5 - TELEMETRY
 * ==================================================================== */
void taskTelemetry(unsigned long now) {
  Serial.print(F("["));  Serial.print(now / 1000); Serial.print(F("s] "));

  Serial.print(F("Hand="));
  if (handDistance == INVALID) Serial.print(F("---"));
  else                         Serial.print(handDistance, 1);
  Serial.print(F("cm"));

  Serial.print(F(" | Lid=")); Serial.print(lidStateName());

  Serial.print(F(" | A="));
  if (fillA == INVALID) Serial.print(F("--"));
  else                  Serial.print(fillA, 0);
  Serial.print(F("%"));

  Serial.print(F(" B="));
  if (fillB == INVALID) Serial.print(F("--"));
  else                  Serial.print(fillB, 0);
  Serial.print(F("%"));

  Serial.print(F(" | Fill="));   Serial.print(fillPercent, 0); Serial.print(F("%"));
  Serial.print(F(" | Status=")); Serial.print(binStatusName());
  Serial.print(F(" | Opens="));  Serial.print(openCount);
  if (unevenLoad)          Serial.print(F(" | UNEVEN LOAD"));
  if (validSensors == 1)   Serial.print(F(" | DEGRADED 1 SENSOR"));
  Serial.println();

  printBar(fillPercent);

  /* Machine readable line - the website dashboard parses this shape. */
  Serial.print(F("{\"id\":\""));        Serial.print(DEVICE_ID);
  Serial.print(F("\",\"fill\":"));      Serial.print(fillPercent, 0);
  Serial.print(F(",\"fillA\":"));       Serial.print(fillA, 0);
  Serial.print(F(",\"fillB\":"));       Serial.print(fillB, 0);
  Serial.print(F(",\"spread\":"));      Serial.print(fillSpread, 0);
  Serial.print(F(",\"uneven\":"));      Serial.print(unevenLoad ? F("true") : F("false"));
  Serial.print(F(",\"sensors\":"));     Serial.print(validSensors);
  Serial.print(F(",\"lid\":\""));       Serial.print(lidStateName());
  Serial.print(F("\",\"status\":\""));  Serial.print(binStatusName());
  Serial.print(F("\",\"opens\":"));     Serial.print(openCount);
  Serial.print(F(",\"errors\":"));      Serial.print(errorCount);
  Serial.print(F(",\"uptime\":"));      Serial.print(now / 1000);
  Serial.println(F("}"));
}

void printBar(float percent) {
  int filled = (int)((percent / 100.0) * 20.0 + 0.5);
  Serial.print(F("        ["));
  for (int i = 0; i < 20; i++) Serial.print(i < filled ? "#" : "-");
  Serial.print(F("] "));
  Serial.print(percent, 0);
  Serial.println(F("%"));
}

/* ======================================================================
 *  ULTRASONIC DRIVER
 * ==================================================================== */

/**************************************************************************
 *  readDistanceCm()
 *  1. A 10 microsecond HIGH pulse on TRIG starts a measurement.
 *  2. The sensor emits 8 bursts of 40 kHz ultrasound.
 *  3. ECHO stays HIGH for exactly as long as the sound is travelling.
 *  4. cm = microseconds / 58.31   (0.0343 cm per us, there and back)
 *  Returns -1 when no echo arrives before the timeout.
 **************************************************************************/
float readDistanceCm(uint8_t trigPin, uint8_t echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  unsigned long duration = pulseIn(echoPin, HIGH, ECHO_TIMEOUT_US);
  if (duration == 0) return INVALID;

  float cm = duration / 58.31;
  if (cm < 2.0 || cm > 400.0) return INVALID;   /* outside sensor range */
  return cm;
}

/**************************************************************************
 *  readDistanceMedian()
 *  Three pings, middle value wins. A crumpled bag can bounce one stray
 *  reading; the median discards it without any averaging lag.
 **************************************************************************/
float readDistanceMedian(uint8_t trigPin, uint8_t echoPin) {
  float a = readDistanceCm(trigPin, echoPin); delay(SENSOR_SETTLE_MS);
  float b = readDistanceCm(trigPin, echoPin); delay(SENSOR_SETTLE_MS);
  float c = readDistanceCm(trigPin, echoPin);

  if (a == INVALID && b == INVALID && c == INVALID) return INVALID;
  if (a == INVALID) a = (b != INVALID) ? b : c;
  if (b == INVALID) b = (c != INVALID) ? c : a;
  if (c == INVALID) c = a;

  float hi = (a > b) ? a : b;
  float lo = (a > b) ? b : a;
  if (c >= hi) return hi;
  if (c <= lo) return lo;
  return c;
}

/* ======================================================================
 *  OPERATOR COMMANDS OVER SERIAL
 *  This is what makes the bin remotely controllable. On the ESP32
 *  version the very same actions are triggered by a Wi-Fi request from
 *  the admin dashboard.
 * ==================================================================== */
void handleSerialCommands() {
  if (!Serial.available()) return;

  String cmd = Serial.readStringUntil(10);   /* 10 = newline character */
  cmd.trim();
  cmd.toUpperCase();

  if (cmd == "OPEN") {
    manualOverride = true;
    lidServo.write(ANGLE_OPEN);
    enterLidState(LID_OPEN, millis());
    Serial.println(F("ACK: lid forced OPEN (manual override active)"));

  } else if (cmd == "CLOSE") {
    manualOverride = true;
    lidServo.write(ANGLE_CLOSED);
    enterLidState(LID_CLOSED, millis());
    Serial.println(F("ACK: lid forced CLOSED (manual override active)"));

  } else if (cmd == "AUTO") {
    manualOverride = false;
    Serial.println(F("ACK: back to automatic mode"));

  } else if (cmd == "MUTE") {
    buzzerEnabled = false;
    digitalWrite(PIN_BUZZER, LOW);
    Serial.println(F("ACK: buzzer muted"));

  } else if (cmd == "UNMUTE") {
    buzzerEnabled = true;
    Serial.println(F("ACK: buzzer enabled"));

  } else if (cmd == "EMPTY") {
    fillPercent = 0; fillA = 0; fillB = 0;
    fillSpread  = 0; unevenLoad = false;
    binStatus   = BIN_OK;
    openCount   = 0;
    Serial.println(F("ACK: bin marked as collected, counters reset"));

  } else if (cmd == "STATUS") {
    taskTelemetry(millis());

  } else if (cmd == "HELP") {
    Serial.println(F("Commands: OPEN CLOSE AUTO MUTE UNMUTE EMPTY STATUS HELP"));

  } else if (cmd.length() > 0) {
    Serial.print(F("ERR: unknown command - type HELP. Received: "));
    Serial.println(cmd);
  }
}

/* ======================================================================
 *  STARTUP HELPERS
 * ==================================================================== */
void banner() {
  Serial.println();
  Serial.println(F("=================================================="));
  Serial.println(F("   SMART DUSTBIN - EMBEDDED SYSTEM"));
  Serial.print  (F("   Device  : ")); Serial.println(DEVICE_ID);
  Serial.print  (F("   Firmware: v")); Serial.println(FIRMWARE_V);
  Serial.println(F("   Sensors : 1 hand + 2 in-bin level (A and B)"));
  Serial.print  (F("   Bin height     : ")); Serial.print(BIN_HEIGHT_CM, 1);
  Serial.println(F(" cm"));
  Serial.print  (F("   Hand threshold : ")); Serial.print(HAND_DETECT_CM, 1);
  Serial.println(F(" cm"));
  Serial.print  (F("   Warn / Full    : ")); Serial.print(LEVEL_WARN_PERCENT, 0);
  Serial.print  (F(" % / ")); Serial.print(LEVEL_FULL_PERCENT, 0);
  Serial.println(F(" %"));
  Serial.print  (F("   Uneven-load gap: ")); Serial.print(LEVEL_DISAGREE_PCT, 0);
  Serial.println(F(" %"));
  Serial.println(F("=================================================="));
}

/**************************************************************************
 *  selfTest()
 *  Blink every output once so an installer can confirm the wiring at a
 *  glance, then ping all three sensors and report which ones answered.
 *  Shipping products do exactly this on power-up.
 **************************************************************************/
void selfTest() {
  Serial.print(F("Power-on self test ... "));
  digitalWrite(PIN_LED_GREEN, HIGH); delay(250); digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED,   HIGH); delay(250); digitalWrite(PIN_LED_RED,   LOW);
  digitalWrite(PIN_BUZZER,    HIGH); delay(150); digitalWrite(PIN_BUZZER,    LOW);
  lidServo.write(ANGLE_OPEN);   delay(500);
  lidServo.write(ANGLE_CLOSED); delay(500);
  Serial.println(F("outputs OK"));

  Serial.print(F("Sensor check: HAND "));
  Serial.print(readDistanceCm(PIN_TRIG_HAND, PIN_ECHO_HAND) == INVALID ? F("no echo") : F("OK"));
  delay(SENSOR_SETTLE_MS);
  Serial.print(F(" | LEVEL-A "));
  Serial.print(readDistanceCm(PIN_TRIG_LEVEL_A, PIN_ECHO_LEVEL_A) == INVALID ? F("no echo") : F("OK"));
  delay(SENSOR_SETTLE_MS);
  Serial.print(F(" | LEVEL-B "));
  Serial.println(readDistanceCm(PIN_TRIG_LEVEL_B, PIN_ECHO_LEVEL_B) == INVALID ? F("no echo") : F("OK"));
}

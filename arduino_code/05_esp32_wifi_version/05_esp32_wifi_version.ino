/**************************************************************************
 *  SMART DUSTBIN - INDUSTRY ORIENTED EMBEDDED SYSTEM
 *  ESP32 firmware  |  Wi-Fi + REST API  |  Firmware v2.0.0-wifi
 *  ------------------------------------------------------------------------
 *  THIS IS THE PRIMARY BUILD FOR THIS PROJECT.
 *  The Arduino UNO version in 04_smart_dustbin_complete has identical
 *  sensing and control logic, but no networking.
 *
 *  THREE ULTRASONIC SENSORS
 *    #1 HAND    - OUTSIDE, on the front face, looking outward.
 *                 A hand within 25 cm makes the servo lift the lid.
 *    #2 LEVEL A - INSIDE the bin, under the lid, front-left diagonal.
 *    #3 LEVEL B - INSIDE the bin, under the lid, rear-right diagonal.
 *
 *  WHY TWO SENSORS INSIDE THE BIN?
 *    Rubbish is never flat. A single downward sensor over a peak reports
 *    "full" while the bin is half empty; one over a hollow reports the
 *    opposite. Two sensors on opposite diagonals give:
 *      1. ACCURACY   - averaging two points beats trusting one.
 *      2. REDUNDANCY - one dies, the bin keeps working on the other.
 *      3. DIAGNOSIS  - a big A-vs-B gap means the load is piled to one side.
 *
 *  WHAT THE ESP32 ADDS OVER THE UNO
 *    - joins Wi-Fi and serves a built-in status page
 *    - GET /api/status            -> live JSON telemetry
 *    - GET /api/command?cmd=OPEN  -> genuine remote control
 *    - the admin dashboard in website/ can drive a real board
 *
 *  LIBRARIES (Library Manager)
 *    ESP32Servo         by Kevin Harrington
 *    LiquidCrystal I2C  by Frank de Brabander   (only if USE_LCD is on)
 *
 *  BOARD SETTINGS
 *    Tools > Board > ESP32 Dev Module
 *    Tools > Upload Speed > 115200
 *
 *  WIRING (3.3 V logic!)
 *    HC-SR04 #1 (hand)     TRIG GPIO5   ECHO GPIO18   VCC 5V(VIN)  GND GND
 *    HC-SR04 #2 (level A)  TRIG GPIO19  ECHO GPIO23   VCC 5V(VIN)  GND GND
 *    HC-SR04 #3 (level B)  TRIG GPIO32  ECHO GPIO33   VCC 5V(VIN)  GND GND
 *    Servo SG90            SIGNAL GPIO13   V+ 5V(VIN)   GND GND
 *    Buzzer                GPIO25
 *    Green LED             GPIO26 - 220R - LED - GND
 *    Red LED               GPIO27 - 220R - LED - GND
 *    LCD 16x2 I2C          SDA GPIO21  SCL GPIO22  VCC 5V  GND GND
 *
 *  IMPORTANT SAFETY NOTE FOR REAL HARDWARE
 *    The HC-SR04 ECHO pin outputs 5 V but ESP32 GPIOs are 3.3 V only.
 *    Put a divider on EACH of the three ECHO lines:
 *        ECHO --[1k]--+--[2k]-- GND        take the ESP32 signal from +
 *    Skipping this works on the bench and slowly destroys the chip.
 *    (In the Wokwi simulator there is nothing to damage, so the divider is
 *     omitted from the simulation diagram for clarity.)
 *
 *  SERIAL COMMANDS (Serial Monitor at 115200 baud, line ending = Newline)
 *    OPEN CLOSE AUTO MUTE UNMUTE EMPTY STATUS WIFI HELP
 **************************************************************************/

/* ======================================================================
 *  BUILD OPTIONS
 *  Comment out USE_LCD if you have no I2C display - everything else keeps
 *  working and the display code disappears from the build entirely.
 * ==================================================================== */
#define USE_LCD

#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>
#ifdef USE_LCD
  #include <Wire.h>
  #include <LiquidCrystal_I2C.h>
  LiquidCrystal_I2C lcd(0x27, 16, 2);   /* try 0x3F if the screen is blank */
#endif

/* ======================================================================
 *  WI-FI CREDENTIALS
 *  For the Wokwi simulator leave these exactly as they are - "Wokwi-GUEST"
 *  with an empty password is the simulator's built-in network.
 *  For real hardware put your own SSID and password here, and blank them
 *  again before you commit the file to a public repository.
 * ==================================================================== */
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASS = "";

/* ======================================================================
 *  1. PIN MAP (ESP32)
 * ==================================================================== */
const int PIN_TRIG_HAND    = 5;
const int PIN_ECHO_HAND    = 18;
const int PIN_TRIG_LEVEL_A = 19;
const int PIN_ECHO_LEVEL_A = 23;
const int PIN_TRIG_LEVEL_B = 32;
const int PIN_ECHO_LEVEL_B = 33;
const int PIN_SERVO        = 13;
const int PIN_BUZZER       = 25;
const int PIN_LED_GREEN    = 26;
const int PIN_LED_RED      = 27;

/* ======================================================================
 *  2. CONFIGURATION - every tunable number lives here
 * ==================================================================== */
const char*  DEVICE_ID  = "BIN-001";
const char*  FIRMWARE_V = "2.0.0-wifi";
const char*  ZONE       = "Central Zone";

const float  BIN_HEIGHT_CM      = 30.0;   /* sensor face to empty floor */
const float  HAND_DETECT_CM     = 25.0;   /* closer than this, open     */
const float  LEVEL_WARN_PERCENT = 75.0;
const float  LEVEL_FULL_PERCENT = 90.0;
const float  LEVEL_DISAGREE_PCT = 25.0;   /* A vs B gap = uneven load   */

const int    ANGLE_CLOSED = 0;
const int    ANGLE_OPEN   = 90;

const unsigned long LID_OPEN_HOLD_MS = 3000;
const unsigned long LID_TRAVEL_MS    = 400;
const unsigned long LID_SAMPLE_MS    = 60;
const unsigned long LEVEL_SAMPLE_MS  = 1000;
const unsigned long TELEMETRY_MS     = 2000;
const unsigned long BEEP_ON_MS       = 200;
const unsigned long BEEP_OFF_MS      = 1800;
const unsigned long SENSOR_SETTLE_MS = 12;    /* anti-crosstalk gap */
const unsigned long ECHO_TIMEOUT_US  = 25000;
const float         INVALID          = -1.0;

/* ======================================================================
 *  3. TYPES AND GLOBAL STATE
 * ==================================================================== */
enum LidState  { LID_CLOSED, LID_OPENING, LID_OPEN, LID_CLOSING };
enum BinStatus { BIN_OK, BIN_WARNING, BIN_FULL, BIN_ERROR };

WebServer server(80);
Servo     lidServo;

LidState  lidState  = LID_CLOSED;
BinStatus binStatus = BIN_OK;

float   handDistance = INVALID;
float   distA        = INVALID;   /* raw cm from level sensor A */
float   distB        = INVALID;   /* raw cm from level sensor B */
float   fillA        = INVALID;   /* percentage seen by A       */
float   fillB        = INVALID;   /* percentage seen by B       */
float   fillPercent  = 0.0;       /* the fused value            */
float   fillSpread   = 0.0;       /* |fillA - fillB|            */
bool    unevenLoad   = false;
uint8_t validSensors = 0;         /* 2 healthy, 1 degraded, 0 failed */

unsigned long stateEnteredAt = 0, lastSeenHandAt = 0;
unsigned int  openCount = 0, errorCount = 0;
bool          buzzerEnabled = true, buzzerOn = false, manualOverride = false;
unsigned long buzzerChanged = 0, blinkChanged = 0;
bool          blinkOn = false;
unsigned long tLid = 0, tLevel = 0, tTelem = 0;

/* ======================================================================
 *  3b. FUNCTION PROTOTYPES
 * ==================================================================== */
void   taskHandDetection(unsigned long now);
void   taskBinLevel(void);
void   taskAlerts(unsigned long now);
void   taskDisplay(void);
void   taskTelemetry(unsigned long now);
void   updateLidStateMachine(bool handDetected, unsigned long now);
void   enterLidState(LidState s, unsigned long now);
bool   lidIsOpen(void);
const char* lidStateName(void);
const char* binStatusName(void);
float  calculateFillPercent(float d);
void   fuseLevelSensors(float dA, float dB);
float  readDistanceCm(int trigPin, int echoPin);
float  readDistanceMedian(int trigPin, int echoPin);
bool   blinkPhase(unsigned long now, unsigned long periodMs);
void   printBar(float percent);
String buildStatusJson(void);
String applyCommand(String cmd);
void   handleSerialCommands(void);
void   handleRoot(void);
void   handleStatus(void);
void   handleCommand(void);
void   connectWifi(void);
void   banner(void);
void   selfTest(void);

/* ======================================================================
 *  4. SETUP
 * ==================================================================== */
void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(PIN_TRIG_HAND,    OUTPUT);  pinMode(PIN_ECHO_HAND,    INPUT);
  pinMode(PIN_TRIG_LEVEL_A, OUTPUT);  pinMode(PIN_ECHO_LEVEL_A, INPUT);
  pinMode(PIN_TRIG_LEVEL_B, OUTPUT);  pinMode(PIN_ECHO_LEVEL_B, INPUT);
  pinMode(PIN_BUZZER,    OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED,   OUTPUT);

  lidServo.setPeriodHertz(50);            /* standard 50 Hz servo    */
  lidServo.attach(PIN_SERVO, 500, 2400);  /* min and max pulse, us   */
  lidServo.write(ANGLE_CLOSED);           /* boot into a safe state  */

#ifdef USE_LCD
  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0); lcd.print("Smart Dustbin");
  lcd.setCursor(0, 1); lcd.print(DEVICE_ID);
#endif

  banner();
  selfTest();
  connectWifi();

  /* REST endpoints consumed by the admin dashboard */
  server.on("/",            handleRoot);
  server.on("/api/status",  handleStatus);
  server.on("/api/command", handleCommand);
  server.begin();
  Serial.println(F("HTTP server started on port 80"));

  stateEnteredAt = millis();
  Serial.println(F("System running. Type HELP for commands."));
  Serial.println();
}

/* ======================================================================
 *  5. LOOP - the cooperative scheduler
 *  Each task asks the clock whether its turn has come. Nothing blocks,
 *  so the loop runs thousands of times per second and Wi-Fi requests are
 *  answered promptly even while the lid is moving.
 * ==================================================================== */
void loop() {
  unsigned long now = millis();

  server.handleClient();          /* answer any pending web request */
  handleSerialCommands();

  if (now - tLid   >= LID_SAMPLE_MS)   { tLid   = now; taskHandDetection(now); }
  if (now - tLevel >= LEVEL_SAMPLE_MS) { tLevel = now; taskBinLevel();         }
  if (now - tTelem >= TELEMETRY_MS)    { tTelem = now; taskTelemetry(now);     }

  taskAlerts(now);
  taskDisplay();
}

/* ======================================================================
 *  WI-FI
 * ==================================================================== */
void connectWifi() {
  Serial.print(F("Connecting to Wi-Fi"));
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(300);
    Serial.print(F("."));
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(F("Connected. Dashboard URL: http://"));
    Serial.println(WiFi.localIP());
    Serial.print(F("Status endpoint:          http://"));
    Serial.print(WiFi.localIP());
    Serial.println(F("/api/status"));
#ifdef USE_LCD
    lcd.clear();
    lcd.setCursor(0, 0); lcd.print("WiFi connected");
    lcd.setCursor(0, 1); lcd.print(WiFi.localIP());
    delay(1500);
    lcd.clear();
#endif
  } else {
    Serial.println(F("Wi-Fi FAILED - the bin keeps working offline."));
  }
}

/* ======================================================================
 *  HTTP HANDLERS
 * ==================================================================== */
void handleStatus() {
  /* CORS header so the dashboard, served from a different origin, is
     allowed to READ this response from JavaScript. Without it the browser
     fetches the data and then refuses to hand it to the page, which looks
     exactly like a network failure and is not. */
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", buildStatusJson());
}

void handleCommand() {
  server.sendHeader("Access-Control-Allow-Origin", "*");

  if (!server.hasArg("cmd")) {
    server.send(400, "application/json",
                "{\"ok\":false,\"error\":\"missing cmd parameter\"}");
    return;
  }

  String cmd    = server.arg("cmd");
  String result = applyCommand(cmd);

  Serial.print(F("HTTP command: ")); Serial.print(cmd);
  Serial.print(F(" -> ")); Serial.println(result);

  String body = "{\"ok\":true,\"command\":\"" + cmd +
                "\",\"result\":\"" + result + "\"}";
  server.send(200, "application/json", body);
}

void handleRoot() {
  String html = "<!doctype html><meta name=viewport content='width=device-width'>";
  html += "<style>body{font-family:-apple-system,system-ui,sans-serif;";
  html += "background:#fff;color:#1d1d1f;padding:32px;max-width:640px;margin:auto}";
  html += "a{color:#0071e3;text-decoration:none}h2{letter-spacing:-.5px}";
  html += "b{font-variant-numeric:tabular-nums}";
  html += ".p{background:#f5f5f7;border-radius:18px;padding:16px 20px;margin:12px 0}";
  html += "</style><h2>Smart Dustbin ";
  html += DEVICE_ID;
  html += "</h2><div class=p>Fill: <b>" + String((int)fillPercent) + "%</b>";
  html += " &nbsp; (A " + String((int)fillA) + "% / B " + String((int)fillB) + "%)<br>";
  html += "Status: <b>" + String(binStatusName()) + "</b><br>";
  html += "Lid: <b>" + String(lidStateName()) + "</b><br>";
  html += "Sensors live: <b>" + String((int)validSensors) + " / 2</b>";
  if (unevenLoad) html += "<br><b style='color:#ff9500'>UNEVEN LOAD</b>";
  html += "</div><div class=p><a href='/api/status'>/api/status</a> &nbsp;|&nbsp; ";
  html += "<a href='/api/command?cmd=OPEN'>OPEN</a> &nbsp;|&nbsp; ";
  html += "<a href='/api/command?cmd=CLOSE'>CLOSE</a> &nbsp;|&nbsp; ";
  html += "<a href='/api/command?cmd=EMPTY'>EMPTY</a></div>";
  server.send(200, "text/html", html);
}

/* ======================================================================
 *  JSON TELEMETRY
 * ==================================================================== */
String buildStatusJson() {
  String j = "{";
  j += "\"id\":\""       + String(DEVICE_ID)  + "\",";
  j += "\"zone\":\""     + String(ZONE)       + "\",";
  j += "\"firmware\":\"" + String(FIRMWARE_V) + "\",";
  j += "\"fill\":"       + String((int)(fillPercent + 0.5)) + ",";
  j += "\"fillA\":"      + String((int)fillA) + ",";
  j += "\"fillB\":"      + String((int)fillB) + ",";
  j += "\"spread\":"     + String((int)(fillSpread + 0.5)) + ",";
  j += "\"uneven\":"     + String(unevenLoad ? "true" : "false") + ",";
  j += "\"sensors\":"    + String((int)validSensors) + ",";
  j += "\"distanceA\":"  + String(distA, 1) + ",";
  j += "\"distanceB\":"  + String(distB, 1) + ",";
  j += "\"lid\":\""      + String(lidStateName())  + "\",";
  j += "\"status\":\""   + String(binStatusName()) + "\",";
  j += "\"opens\":"      + String(openCount)  + ",";
  j += "\"errors\":"     + String(errorCount) + ",";
  j += "\"muted\":"      + String(buzzerEnabled ? "false" : "true") + ",";
  j += "\"manual\":"     + String(manualOverride ? "true" : "false") + ",";
  j += "\"rssi\":"       + String((int)WiFi.RSSI()) + ",";
  j += "\"uptime\":"     + String(millis() / 1000);
  j += "}";
  return j;
}

/* ======================================================================
 *  COMMANDS - one implementation, reached from both Wi-Fi and serial
 * ==================================================================== */
String applyCommand(String cmd) {
  cmd.trim();
  cmd.toUpperCase();

  if (cmd == "OPEN")   { manualOverride = true;  lidServo.write(ANGLE_OPEN);
                         enterLidState(LID_OPEN, millis());   return "lid forced open"; }
  if (cmd == "CLOSE")  { manualOverride = true;  lidServo.write(ANGLE_CLOSED);
                         enterLidState(LID_CLOSED, millis()); return "lid forced closed"; }
  if (cmd == "AUTO")   { manualOverride = false;              return "automatic mode"; }
  if (cmd == "MUTE")   { buzzerEnabled = false;
                         digitalWrite(PIN_BUZZER, LOW);       return "buzzer muted"; }
  if (cmd == "UNMUTE") { buzzerEnabled = true;                return "buzzer enabled"; }
  if (cmd == "EMPTY")  { fillPercent = 0; fillA = 0; fillB = 0; fillSpread = 0;
                         unevenLoad = false; binStatus = BIN_OK; openCount = 0;
                         return "bin marked collected, counters reset"; }
  return "unknown command";
}

void handleSerialCommands() {
  if (!Serial.available()) return;

  String cmd = Serial.readStringUntil(10);   /* 10 = newline character */
  cmd.trim();
  cmd.toUpperCase();
  if (cmd.length() == 0) return;

  if (cmd == "STATUS") { taskTelemetry(millis()); return; }

  if (cmd == "WIFI") {
    Serial.print(F("SSID: ")); Serial.println(WIFI_SSID);
    Serial.print(F("State: "));
    if (WiFi.status() == WL_CONNECTED) {
      Serial.print(F("connected, IP http://")); Serial.print(WiFi.localIP());
      Serial.print(F(", RSSI ")); Serial.println(WiFi.RSSI());
    } else {
      Serial.println(F("not connected"));
    }
    return;
  }

  if (cmd == "HELP") {
    Serial.println(F("Commands: OPEN CLOSE AUTO MUTE UNMUTE EMPTY STATUS WIFI HELP"));
    return;
  }

  String result = applyCommand(cmd);
  if (result == "unknown command") {
    Serial.print(F("ERR: unknown command - type HELP. Received: "));
    Serial.println(cmd);
  } else {
    Serial.print(F("ACK: ")); Serial.println(result);
  }
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
 *  The CLOSING to OPENING edge is a safety feature: a hand returning while
 *  the lid is coming down re-opens it immediately.
 **************************************************************************/
void updateLidStateMachine(bool handDetected, unsigned long now) {
  if (handDetected) lastSeenHandAt = now;

  switch (lidState) {
    case LID_CLOSED:
      if (handDetected) {
        lidServo.write(ANGLE_OPEN); openCount++;
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

void enterLidState(LidState s, unsigned long now) { lidState = s; stateEnteredAt = now; }
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
 *  Skipped while the lid is open, because with the lid up both sensors see
 *  the sky or the arm of the user instead of the rubbish.
 * ==================================================================== */
void taskBinLevel() {
  if (lidIsOpen()) return;

  distA = readDistanceMedian(PIN_TRIG_LEVEL_A, PIN_ECHO_LEVEL_A);
  delay(SENSOR_SETTLE_MS);         /* let A's echoes die before B fires */
  distB = readDistanceMedian(PIN_TRIG_LEVEL_B, PIN_ECHO_LEVEL_B);

  fuseLevelSensors(distA, distB);

  if      (validSensors == 0)                 { errorCount++; binStatus = BIN_ERROR; }
  else if (fillPercent >= LEVEL_FULL_PERCENT) binStatus = BIN_FULL;
  else if (fillPercent >= LEVEL_WARN_PERCENT) binStatus = BIN_WARNING;
  else                                        binStatus = BIN_OK;
}

/**************************************************************************
 *  calculateFillPercent()   - one sensor, pure maths
 *      30.0 cm ->   0 %      22.5 cm ->  25 %
 *      15.0 cm ->  50 %       7.5 cm ->  75 %
 *       3.0 cm ->  90 %       0.0 cm -> 100 %
 **************************************************************************/
float calculateFillPercent(float d) {
  if (d < 0) return INVALID;          /* the "no echo" sentinel */
  if (d > BIN_HEIGHT_CM) d = BIN_HEIGHT_CM;

  float pct = ((BIN_HEIGHT_CM - d) / BIN_HEIGHT_CM) * 100.0;
  if (pct < 0)   pct = 0;
  if (pct > 100) pct = 100;
  return pct;
}

/**************************************************************************
 *  fuseLevelSensors()
 *    Both valid -> average, and flag a large disagreement as uneven.
 *    One valid  -> keep working in a clearly degraded mode.
 *    Neither    -> report failure rather than inventing a number.
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
    validSensors = 1; fillPercent = fillA;
  } else if (bOk) {
    validSensors = 1; fillPercent = fillB;
  } else {
    validSensors = 0;   /* keep the last known fillPercent */
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
      digitalWrite(PIN_BUZZER,    LOW); buzzerOn = false;
      break;

    case BIN_WARNING:
      digitalWrite(PIN_LED_GREEN, HIGH);
      digitalWrite(PIN_LED_RED,   blinkPhase(now, 500) ? HIGH : LOW);
      digitalWrite(PIN_BUZZER,    LOW); buzzerOn = false;
      break;

    case BIN_FULL:
      digitalWrite(PIN_LED_GREEN, LOW);
      digitalWrite(PIN_LED_RED,   HIGH);
      if (!buzzerEnabled) {
        digitalWrite(PIN_BUZZER, LOW); buzzerOn = false;
      } else if (buzzerOn && (now - buzzerChanged >= BEEP_ON_MS)) {
        buzzerOn = false; digitalWrite(PIN_BUZZER, LOW);  buzzerChanged = now;
      } else if (!buzzerOn && (now - buzzerChanged >= BEEP_OFF_MS)) {
        buzzerOn = true;  digitalWrite(PIN_BUZZER, HIGH); buzzerChanged = now;
      }
      break;

    case BIN_ERROR:
      digitalWrite(PIN_LED_GREEN, LOW);
      digitalWrite(PIN_LED_RED,   blinkPhase(now, 150) ? HIGH : LOW);
      digitalWrite(PIN_BUZZER,    LOW); buzzerOn = false;
      break;
  }
}

bool blinkPhase(unsigned long now, unsigned long periodMs) {
  if (now - blinkChanged >= periodMs) { blinkOn = !blinkOn; blinkChanged = now; }
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
  if (unevenLoad)        Serial.print(F(" | UNEVEN LOAD"));
  if (validSensors == 1) Serial.print(F(" | DEGRADED 1 SENSOR"));
  Serial.println();

  printBar(fillPercent);

  /* Machine readable line - the website dashboard parses this shape. */
  Serial.println(buildStatusJson());
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
float readDistanceCm(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH); delayMicroseconds(10);
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
float readDistanceMedian(int trigPin, int echoPin) {
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
 *  STARTUP HELPERS
 * ==================================================================== */
void banner() {
  Serial.println();
  Serial.println(F("=================================================="));
  Serial.println(F("   SMART DUSTBIN - EMBEDDED SYSTEM (ESP32)"));
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

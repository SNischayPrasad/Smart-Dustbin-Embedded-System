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
 *  FULL-BIN LOCKDOWN
 *    A bin at FULL refuses to open for a hand. Letting one more person push
 *    rubbish into a full bin is exactly how bins overflow onto the street,
 *    so the lid stays shut, the red LED stays on, and each refused approach
 *    is counted. Two things still open it:
 *      - the safety re-open (a hand returning while the lid comes down),
 *        because a lid must never close on somebody's hand, and
 *      - the operator's OPEN command - the crew override used to empty it.
 *    Emptying the bin drops it below FULL, which releases the lock.
 *    website/assets/js/sim.js mirrors this logic line for line.
 *
 *  WHAT THE ESP32 ADDS OVER THE UNO
 *    - joins Wi-Fi and serves a built-in status page
 *    - GET /api/status            -> live JSON telemetry
 *    - GET /api/command?cmd=OPEN  -> genuine remote control
 *    - the admin dashboard in website/ can drive a real board
 *    - OPTIONAL CLOUD SYNC: with a secrets.h next to this file, the board
 *      reports into Firestore bins/<DEVICE_ID> and obeys commands queued
 *      from any dashboard, anywhere - no browser ever talks to the board.
 *      A FreeRTOS task on core 0 does all of that networking, so loop()
 *      on core 1 never waits for the internet (see CLOUD SYNC below).
 *
 *  LIBRARIES (Library Manager)
 *    ESP32Servo         by Kevin Harrington
 *    LiquidCrystal I2C  by Frank de Brabander   (only if USE_LCD is on)
 *    (HTTPClient and WiFiClientSecure used by cloud sync ship with the core)
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
 *    OPEN CLOSE AUTO MUTE UNMUTE EMPTY PING STATUS WIFI CLOUD HELP
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
 *  CLOUD SYNC SWITCH
 *  Cloud sync turns itself ON when a file called secrets.h sits next to
 *  this sketch, and OFF when it does not - no #define to forget. secrets.h
 *  holds the board's own Firebase login and is listed in .gitignore, so it
 *  can never be pushed to GitHub. Copy secrets.example.h to start.
 *  (__has_include is a standard C++17 preprocessor test, supported by the
 *  GCC that ships with the ESP32 core.)
 * ==================================================================== */
#if __has_include("secrets.h")
  #include "secrets.h"
  #define CLOUD_SYNC 1
  #if !defined(DEVICE_EMAIL) || !defined(DEVICE_PASSWORD)
    #error "secrets.h must #define DEVICE_EMAIL and DEVICE_PASSWORD - see secrets.example.h"
  #endif
#else
  #define CLOUD_SYNC 0
#endif

#if CLOUD_SYNC
  #include <WiFiClientSecure.h>
  #include <HTTPClient.h>
  /* The Mozilla root-certificate bundle compiled into the ESP32 core. With it
     the TLS layer checks that it really is talking to Google - the only
     thing that makes sending a password over the network safe. It costs
     about 66 KB of flash, which is why it is only linked when sync is on. */
  extern const uint8_t x509_crt_imported_bundle_bin_start[] asm("_binary_x509_crt_bundle_start");
  extern const uint8_t x509_crt_imported_bundle_bin_end[]   asm("_binary_x509_crt_bundle_end");
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
 *  2b. CLOUD SYNC TUNING (only used when secrets.h exists)
 *  The Firebase apiKey and project id are PUBLIC by design - the very same
 *  values are in website/assets/js/firebase-config.js. They only say WHICH
 *  project to talk to. What protects the data is the board's password (in
 *  secrets.h) plus the Firestore rules, which let this board's account
 *  write nothing but the "device" and "commandAck" fields of its own bin.
 *
 *  QUOTA MATHS - the Firestore free tier is 20,000 writes and 50,000 reads
 *  per day for the WHOLE project:
 *    polling every 10 s          = 8,640 reads/day per board
 *    heartbeat every 60 s        = 1,440 writes/day for a quiet bin
 *    worst case, a change every 5 s = 17,280 writes/day
 *  So one board fits comfortably, a handful fit for a demo, and a real
 *  fleet would lengthen these intervals or move to MQTT.
 * ==================================================================== */
const char* FIREBASE_API_KEY = "AIzaSyDR7IGdS2Br7u_2iLALcS3hgRCiDFtZtGI";
const char* FIREBASE_PROJECT = "sdbs-399da";

const unsigned long CLOUD_MIN_PUSH_MS    = 5000;    /* never report faster than this */
const unsigned long CLOUD_HEARTBEAT_MS   = 60000;   /* report even if nothing moved  */
const unsigned long CLOUD_POLL_MS        = 10000;   /* look for a queued command     */
const unsigned long CLOUD_TOKEN_SLACK_MS = 300000;  /* refresh with 5 min to spare   */
const int           CLOUD_FILL_STEP      = 1;       /* fill change (%) worth a push  */
const uint32_t      CLOUD_TASK_STACK     = 12288;   /* bytes - TLS needs a deep stack */

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
unsigned int  refusedCount   = 0;      /* approaches turned away while locked */
bool          refusalLatched = false;  /* one refusal per approach, not per poll */
bool          buzzerEnabled = true, buzzerOn = false, manualOverride = false;
unsigned long buzzerChanged = 0, blinkChanged = 0;
bool          blinkOn = false;
unsigned long tLid = 0, tLevel = 0, tTelem = 0;

#if CLOUD_SYNC
/* ----------------------------------------------------------------------
 *  3a. STATE SHARED BETWEEN THE TWO CPU CORES
 *  loop() runs on core 1, the cloud task on core 0 - truly at the same
 *  time, not taking turns. Two rules keep that safe:
 *    1. Structs that both cores touch are copied whole inside a critical
 *       section (portENTER_CRITICAL), so neither core can ever read a
 *       half-written struct. Plain values only - no String, no pointers -
 *       so a struct assignment is a complete copy.
 *    2. Commands and acknowledgements travel through FreeRTOS queues,
 *       which are thread-safe by design: one core posts, the other
 *       collects when it is ready, nobody waits.
 * -------------------------------------------------------------------- */
struct CloudSnapshot {           /* loop() -> task, once per telemetry tick */
  int  fill, fillA, fillB, opens, refused, errors, sensors, rssi;
  bool locked;
  char lid[8];                   /* "CLOSING" + NUL      */
  char status[13];               /* "SENSOR_ERROR" + NUL */
  bool valid;                    /* false until loop() has published once */
};
struct CloudCommand {            /* task -> loop() through cloudCmdQueue */
  char cmd[8];
  char id[41];
};
struct CloudAck {                /* loop() -> task through cloudAckQueue */
  char id[41];
  char result[48];
};
struct CloudStatus {             /* task -> the CLOUD serial command */
  bool          signedIn;
  int           lastHttp;        /* last HTTP status, negative = network error */
  unsigned long lastPushAt;      /* millis() of the last good report, 0 = never */
  uint32_t      pushes, polls;
  uint32_t      stackFree;       /* task stack never used so far, bytes */
  char          lastCmdId[41];
  char          uid[40];
};

portMUX_TYPE  cloudMux      = portMUX_INITIALIZER_UNLOCKED;  /* guards the two below */
CloudSnapshot cloudSnap;         /* written by loop(), read by the task   */
CloudStatus   cloudStat;         /* written by the task, read by loop()   */
QueueHandle_t cloudCmdQueue = NULL;
QueueHandle_t cloudAckQueue = NULL;
#endif

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
bool   binLocked(void);
const char* lidStateName(void);
const char* binStatusName(void);
float  calculateFillPercent(float d);
int    pctToInt(float v);
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
void   cloudBegin(void);
void   cloudServiceLoop(void);
void   cloudPublishSnapshot(void);
void   cloudPrintStatus(void);
const char* cloudStateText(void);
#if CLOUD_SYNC
void   cloudTask(void* arg);
bool   cloudEnsureToken(void);
bool   cloudSignIn(void);
bool   cloudRefresh(void);
bool   cloudCommit(const CloudSnapshot& s, const CloudAck* ack);
void   cloudPoll(void);
int    cloudHttp(const char* method, const String& url, const String& body,
                 const char* contentType, bool withToken, String& reply);
int    cloudFirestore(const char* method, const String& url, const String& body,
                      String& reply);
void   cloudNoteHttp(int code, const String& reply);
String cloudDocName(void);
String jsonStringValue(const String& body, const char* key, int from);
String firestoreString(const String& body, const char* key, int from);
String jsonEscape(const char* s);
String fsInt(const char* key, int v);
String fsStr(const char* key, const char* v);
String fsBool(const char* key, bool v);
bool   cloudIdIsSafe(const String& id);
bool   cloudCmdAllowed(const String& cmd);
#endif

/* ======================================================================
 *  4. SETUP
 * ==================================================================== */
void setup() {
  Serial.begin(115200);
  delay(200);

  /* readStringUntil() waits for a newline, and gives up after this long.
     The default is a full SECOND - so a half-typed command would freeze
     loop(), and with it the lid, for a second. 20 ms is far longer than
     the gap between characters at 115200 baud, and invisible to the lid. */
  Serial.setTimeout(20);

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

  cloudBegin();                   /* starts the core-0 task, or says why not */

  stateEnteredAt = millis();
  Serial.println(F("System running. Type HELP for commands."));
  Serial.println();
}

/* ======================================================================
 *  5. LOOP - the cooperative scheduler
 *  Each task asks the clock whether its turn has come. Nothing blocks,
 *  so the loop runs thousands of times per second and Wi-Fi requests are
 *  answered promptly even while the lid is moving.
 *  The slow part - HTTPS to the cloud, 0.5 to 2 s per request - is not in
 *  here at all: it lives in its own FreeRTOS task on the other core.
 * ==================================================================== */
void loop() {
  unsigned long now = millis();

  server.handleClient();          /* answer any pending web request */
  handleSerialCommands();
  cloudServiceLoop();             /* run commands queued from the cloud */

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
  /* Wokwi's network is always on channel 6; naming it skips a 4 s scan of
     every channel. Channel 0 means "scan them all", which real routers need. */
  bool wokwi = (strcmp(WIFI_SSID, "Wokwi-GUEST") == 0);
  WiFi.begin(WIFI_SSID, WIFI_PASS, wokwi ? 6 : 0);

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

  String cmd = server.arg("cmd");
  cmd.trim();
  cmd.toUpperCase();

  String result = applyCommand(cmd);
  bool   known  = (result != "unknown command");

  Serial.print(F("HTTP command: ")); Serial.print(cmd);
  Serial.print(F(" -> ")); Serial.println(result);

  /* This JSON is assembled by hand, so ONLY fixed words may enter it.
     `cmd` arrives from the query string and anybody can put a quote or a
     backslash in it - echoing that back would close the string early and
     hand the caller a broken (or forged) reply. So an unrecognised command
     is reported as the constant "unknown"; it is never echoed. `result` is
     always one of applyCommand()'s own literals, so it is safe as it is. */
  String body = String("{\"ok\":") + (known ? "true" : "false") +
                ",\"command\":\"" + (known ? cmd : String("unknown")) +
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
  html += "Sensors live: <b>" + String((int)validSensors) + " / 2</b><br>";
  html += "Cloud sync: <b>" + String(cloudStateText()) + "</b>";
  if (binLocked()) {
    html += "<br><b style='color:#ff3b30'>LOCKED - FULL</b> (hands refused: ";
    html += String(refusedCount) + ", crew override: OPEN)";
  }
  if (unevenLoad) html += "<br><b style='color:#ff9500'>UNEVEN LOAD</b>";
  html += "</div><div class=p><a href='/api/status'>/api/status</a> &nbsp;|&nbsp; ";
  html += "<a href='/api/command?cmd=OPEN'>OPEN</a> &nbsp;|&nbsp; ";
  html += "<a href='/api/command?cmd=CLOSE'>CLOSE</a> &nbsp;|&nbsp; ";
  html += "<a href='/api/command?cmd=AUTO'>AUTO</a> &nbsp;|&nbsp; ";
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
  j += "\"fill\":"       + String(pctToInt(fillPercent)) + ",";
  j += "\"fillA\":"      + String(pctToInt(fillA)) + ",";
  j += "\"fillB\":"      + String(pctToInt(fillB)) + ",";
  j += "\"spread\":"     + String(pctToInt(fillSpread)) + ",";
  j += "\"uneven\":"     + String(unevenLoad ? "true" : "false") + ",";
  j += "\"sensors\":"    + String((int)validSensors) + ",";
  j += "\"distanceA\":"  + String(distA, 1) + ",";
  j += "\"distanceB\":"  + String(distB, 1) + ",";
  j += "\"lid\":\""      + String(lidStateName())  + "\",";
  j += "\"status\":\""   + String(binStatusName()) + "\",";
  j += "\"locked\":"     + String(binLocked() ? "true" : "false") + ",";
  j += "\"opens\":"      + String(openCount)  + ",";
  j += "\"refused\":"    + String(refusedCount) + ",";
  j += "\"errors\":"     + String(errorCount) + ",";
  j += "\"muted\":"      + String(buzzerEnabled ? "false" : "true") + ",";
  j += "\"manual\":"     + String(manualOverride ? "true" : "false") + ",";
  j += "\"rssi\":"       + String((int)WiFi.RSSI()) + ",";
  j += "\"uptime\":"     + String(millis() / 1000);
  j += "}";
  return j;
}

/* ======================================================================
 *  COMMANDS - one implementation, reached from Wi-Fi, serial AND the cloud
 *  OPEN is also the crew override: it opens a locked (FULL) bin, and the
 *  reply says so, so nobody mistakes it for the lockdown failing.
 * ==================================================================== */
String applyCommand(String cmd) {
  cmd.trim();
  cmd.toUpperCase();

  if (cmd == "OPEN")   { manualOverride = true;  lidServo.write(ANGLE_OPEN);
                         enterLidState(LID_OPEN, millis());
                         return binLocked() ? "lid forced open (crew override - bin FULL)"
                                            : "lid forced open"; }
  if (cmd == "CLOSE")  { manualOverride = true;  lidServo.write(ANGLE_CLOSED);
                         enterLidState(LID_CLOSED, millis()); return "lid forced closed"; }
  if (cmd == "AUTO")   { manualOverride = false;              return "automatic mode"; }
  if (cmd == "MUTE")   { buzzerEnabled = false; buzzerOn = false;
                         digitalWrite(PIN_BUZZER, LOW);       return "buzzer muted"; }
  if (cmd == "UNMUTE") { buzzerEnabled = true;                return "buzzer enabled"; }
  if (cmd == "EMPTY")  { fillPercent = 0; fillA = 0; fillB = 0; fillSpread = 0;
                         unevenLoad = false; binStatus = BIN_OK; openCount = 0;
                         refusedCount = 0;      /* BIN_OK also releases the lock */
                         return "bin marked collected, counters reset"; }
  if (cmd == "PING")   {                                      return "pong - device online"; }
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

  if (cmd == "CLOUD") { cloudPrintStatus(); return; }

  if (cmd == "HELP") {
    Serial.println(F("Commands: OPEN CLOSE AUTO MUTE UNMUTE EMPTY PING STATUS WIFI CLOUD HELP"));
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
 *        hand seen AND locked:
 *        stay shut, count ONE refusal
 *        per approach
 *          +-----+
 *          |     |
 *          |     v
 *      +----------+  hand seen AND  +-----------+  travel done  +--------+
 *      |  CLOSED  |---------------->|  OPENING  |-------------->|  OPEN  |
 *      +----------+   NOT locked    +-----------+               +--------+
 *           ^                             ^                          |
 *           | travel done                 | hand returns             | no hand
 *           |                             | (even when FULL)         | for 3 s
 *      +----------+                       |                          |
 *      | CLOSING  |<----------------------+--------------------------+
 *      +----------+
 *
 *      locked = (binStatus == FULL)        see binLocked()
 *
 *  The CLOSING to OPENING edge is a safety feature: a hand returning while
 *  the lid is coming down re-opens it immediately - even on a bin that
 *  turned FULL meanwhile. Safety beats lockdown. The operator's OPEN
 *  command bypasses this machine entirely (manualOverride).
 **************************************************************************/
void updateLidStateMachine(bool handDetected, unsigned long now) {
  if (handDetected) lastSeenHandAt = now;
  else              refusalLatched = false;   /* hand gone: next approach counts */

  switch (lidState) {
    case LID_CLOSED:
      if (handDetected && binLocked()) {
        /* The sensor polls every 60 ms, so without the latch one person
           standing there would be counted - and printed - 16 times a second. */
        if (!refusalLatched) {
          refusalLatched = true;
          refusedCount++;
          Serial.println(F("### Bin FULL - lid locked until it is emptied"));
        }
      } else if (handDetected) {
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
      /* Safety beats lockdown: even if the bin turned FULL while the lid
         was coming down, a returning hand re-opens it. */
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

/**************************************************************************
 *  binLocked() - the whole lockdown policy is this one line
 *  SENSOR_ERROR deliberately does not lock: when the level is unknown,
 *  stranding every user would be worse than an occasional overfill.
 **************************************************************************/
bool binLocked() { return binStatus == BIN_FULL; }

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
 *  pctToInt()
 *  Rounds a percentage for the wire, the way the JavaScript twin's
 *  Math.round() does - so a bin reading 72.6 % is "73" on the serial line,
 *  in the JSON and on the dashboard, not 72 in one place and 73 in another.
 *
 *  The -1 "no echo" sentinel is passed straight through. Plain
 *  (int)(v + 0.5) would turn -1.0 into 0, quietly reporting "this sensor
 *  says the bin is empty" when what happened is "this sensor said nothing".
 **************************************************************************/
int pctToInt(float v) { return (v < 0) ? -1 : (int)(v + 0.5); }

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

  /* A locked bin shows LOCKED in place of FULL - locked always means full,
     and it tells the person at the bin WHY the lid ignores them:
     "Fill: 95% LOCKED" is exactly 16 characters. */
  if (binStatus == BIN_ERROR) {
    snprintf(line1, sizeof(line1), "SENSOR ERROR    ");
  } else {
    snprintf(line1, sizeof(line1), "Fill:%3d%% %-6s",
             (int)(fillPercent + 0.5), binLocked() ? "LOCKED" : binStatusName());
  }

  /* Redraw only on change - constant redrawing floods the I2C bus. */
  if (strcmp(line0, prev0) != 0) { lcd.setCursor(0,0); lcd.print(line0); strcpy(prev0, line0); }
  if (strcmp(line1, prev1) != 0) { lcd.setCursor(0,1); lcd.print(line1); strcpy(prev1, line1); }
#endif
}

/* ======================================================================
 *  TASK 5 - TELEMETRY
 *  Also hands a copy of the numbers to the cloud task (when sync is on).
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
  if (binLocked())       Serial.print(F(" | LOCKED"));
  if (unevenLoad)        Serial.print(F(" | UNEVEN LOAD"));
  if (validSensors == 1) Serial.print(F(" | DEGRADED 1 SENSOR"));
  Serial.println();

  printBar(fillPercent);

  /* Machine readable line - the website dashboard parses this shape. */
  Serial.println(buildStatusJson());

  cloudPublishSnapshot();
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
  Serial.println(F("   Full lockdown  : ON (crew override: OPEN)"));
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

/**************************************************************************
 *  CLOUD SYNC
 *  ------------------------------------------------------------------------
 *  GOAL: this board shows up live on every dashboard, and obeys commands
 *  queued from them, without any browser ever connecting to the board.
 *  Both sides meet in the middle, in ONE Firestore document:
 *
 *      board --report every 5-60 s--> bins/BIN-001.device     --> dashboards
 *      board <--poll every 10 s------ bins/BIN-001.command    <-- a dashboard
 *      board --acknowledge----------> bins/BIN-001.commandAck --> that dashboard
 *
 *  WHY A SEPARATE RTOS TASK ON CORE 0
 *    One HTTPS request takes 0.5 to 2 s (a TLS handshake plus a round trip
 *    to Google). Done inside loop(), the lid would ignore hands for that
 *    long, several times a minute. The ESP32 has TWO cores and runs
 *    FreeRTOS, so the networking gets its own task, pinned to core 0 - the
 *    core that already runs the Wi-Fi driver - and loop() keeps core 1:
 *
 *        core 1  loop()      sensors, lid, LEDs, LCD, web page   never waits
 *        core 0  cloudTask   sign in, report, poll, acknowledge  may wait
 *
 *    They share data in exactly two ways (section 3a): a snapshot struct
 *    copied under a critical section, and two FreeRTOS queues. The servo is
 *    only ever driven from core 1 - a cloud command is queued, and loop()
 *    applies it with the same applyCommand() the web page and serial use.
 *
 *  NEVER REPLAY A COMMAND AFTER A REBOOT
 *    The first poll after power-up only RECORDS the id of whatever command
 *    is waiting; it does not run it. The board keeps no memory across a
 *    reboot, so it cannot know whether it already obeyed that command -
 *    and an OPEN sent hours ago must not swing the lid open by itself when
 *    the power comes back at 3 a.m. The dashboard sees no acknowledgement
 *    and the operator can simply send it again.
 *
 *  PLAIN REST, NO FIREBASE LIBRARY
 *    Four HTTPS calls and a few indexOf() helpers: nothing to install, and
 *    every byte that goes over the wire is visible in this file. Nothing a
 *    user typed is ever pasted into the JSON we send - only numbers, fixed
 *    words, and a command id that has been checked character by character.
 **************************************************************************/

/* ---- Called by the rest of the sketch - present in BOTH builds -------- */

void cloudBegin() {
#if CLOUD_SYNC
  cloudCmdQueue = xQueueCreate(4, sizeof(CloudCommand));
  cloudAckQueue = xQueueCreate(4, sizeof(CloudAck));
  if (cloudCmdQueue == NULL || cloudAckQueue == NULL) {
    Serial.println(F("Cloud: not enough memory for the queues - sync disabled"));
    return;
  }

  /* 12 KB stack, priority 1 (just above idle), pinned to core 0. */
  if (xTaskCreatePinnedToCore(cloudTask, "cloud", CLOUD_TASK_STACK,
                              NULL, 1, NULL, 0) != pdPASS) {
    Serial.println(F("Cloud: could not start the cloud task - sync disabled"));
    return;
  }
  Serial.print(F("Cloud: sync ON - reporting to Firestore bins/"));
  Serial.println(DEVICE_ID);
#else
  Serial.println(F("Cloud: sync OFF - add secrets.h next to the sketch (copy secrets.example.h) to report to the dashboards"));
#endif
}

/* loop() side: take every command the task has queued, apply it exactly as
   if it had been typed, and hand back the result. Never waits. */
void cloudServiceLoop() {
#if CLOUD_SYNC
  if (cloudCmdQueue == NULL) return;

  CloudCommand c;
  while (xQueueReceive(cloudCmdQueue, &c, 0) == pdTRUE) {   /* 0 = do not wait */
    String result = applyCommand(String(c.cmd));
    Serial.print(F("Cloud: command ")); Serial.print(c.cmd);
    Serial.print(F(" -> "));            Serial.println(result);

    cloudPublishSnapshot();          /* so the acknowledgement carries the NEW state */

    CloudAck a;
    strlcpy(a.id,     c.id,           sizeof(a.id));
    strlcpy(a.result, result.c_str(), sizeof(a.result));
    if (xQueueSend(cloudAckQueue, &a, 0) != pdTRUE) {
      Serial.println(F("Cloud: acknowledgement queue full - ack dropped"));
    }
  }
#endif
}

/* loop() side: copy the numbers the dashboards need into the shared
   snapshot. Built outside the critical section, copied inside it, so the
   other core is held up for a microsecond or two at most. */
void cloudPublishSnapshot() {
#if CLOUD_SYNC
  CloudSnapshot s;
  s.fill    = pctToInt(fillPercent);
  s.fillA   = pctToInt(fillA);        /* -1 = sensor A gave no echo */
  s.fillB   = pctToInt(fillB);
  s.opens   = (int)openCount;
  s.refused = (int)refusedCount;
  s.errors  = (int)errorCount;
  s.sensors = (int)validSensors;
  s.rssi    = (int)WiFi.RSSI();
  s.locked  = binLocked();
  strlcpy(s.lid,    lidStateName(),  sizeof(s.lid));
  strlcpy(s.status, binStatusName(), sizeof(s.status));
  s.valid   = true;

  portENTER_CRITICAL(&cloudMux);
  cloudSnap = s;
  portEXIT_CRITICAL(&cloudMux);
#endif
}

const char* cloudStateText() {
#if CLOUD_SYNC
  bool in;
  portENTER_CRITICAL(&cloudMux);
  in = cloudStat.signedIn;
  portEXIT_CRITICAL(&cloudMux);
  return in ? "on - signed in" : "on - not signed in yet";
#else
  return "off (no secrets.h)";
#endif
}

/* The CLOUD serial command. */
void cloudPrintStatus() {
#if CLOUD_SYNC
  CloudStatus st;
  portENTER_CRITICAL(&cloudMux);
  st = cloudStat;
  portEXIT_CRITICAL(&cloudMux);

  Serial.print(F("Cloud: enabled | project ")); Serial.print(FIREBASE_PROJECT);
  Serial.print(F(" | document bins/"));        Serial.println(DEVICE_ID);
  Serial.print(F("Cloud: signed in: "));       Serial.print(st.signedIn ? F("yes") : F("no"));
  if (st.uid[0]) { Serial.print(F(" (device UID ")); Serial.print(st.uid); Serial.print(F(")")); }
  Serial.println();
  Serial.print(F("Cloud: last push: "));
  if (st.lastPushAt == 0) Serial.print(F("never"));
  else { Serial.print((millis() - st.lastPushAt) / 1000); Serial.print(F(" s ago")); }
  Serial.print(F(" | pushes ")); Serial.print(st.pushes);
  Serial.print(F(" | polls "));  Serial.println(st.polls);
  Serial.print(F("Cloud: last HTTP code: ")); Serial.print(st.lastHttp);
  Serial.print(F(" | last command id: "));    Serial.println(st.lastCmdId[0] ? st.lastCmdId : "(none)");
  Serial.print(F("Cloud: task stack never used: ")); Serial.print(st.stackFree);
  Serial.print(F(" B | free heap: "));             Serial.print(ESP.getFreeHeap());
  Serial.println(F(" B"));
#else
  Serial.println(F("Cloud: disabled - there is no secrets.h next to the sketch (see secrets.example.h)"));
#endif
}

#if CLOUD_SYNC
/* ======================================================================
 *  EVERYTHING BELOW RUNS ON CORE 0, INSIDE cloudTask
 *  These variables are private to that task - loop() never touches them,
 *  so they need no lock.
 * ==================================================================== */
static WiFiClientSecure* cloudTls = NULL;
static String        cloudIdToken;              /* proves who we are, ~1 h life */
static String        cloudRefreshTok;           /* trades for a new idToken     */
static unsigned long cloudTokenAt     = 0;      /* millis() when it arrived     */
static unsigned long cloudTokenLifeMs = 0;
static bool          cloudSignedIn    = false;
static unsigned long cloudRetryAt     = 0;      /* sign-in back-off             */
static unsigned long cloudRetryGap    = 0;
static bool          cloudBaselined   = false;  /* first poll after boot done?  */
static String        cloudLastCmdId;            /* last command id seen         */
static bool          cloudFirstPush   = true;

void cloudTask(void* arg) {
  (void)arg;

  /* TLS client that checks Google's certificate against the built-in
     root bundle. Core 3.x wants the bundle's size; core 2.x does not. */
  cloudTls = new WiFiClientSecure();
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  cloudTls->setCACertBundle(x509_crt_imported_bundle_bin_start,
                            x509_crt_imported_bundle_bin_end - x509_crt_imported_bundle_bin_start);
#else
  cloudTls->setCACertBundle(x509_crt_imported_bundle_bin_start);
#endif
  cloudTls->setHandshakeTimeout(10);         /* seconds */

  CloudSnapshot pushed;                      /* what the cloud holds now */
  memset(&pushed, 0, sizeof(pushed));
  bool          everPushed   = false, attempted = false, lastFailed = false;
  unsigned long lastAttempt  = 0, lastOkAt = 0, lastPollAt = 0;
  bool          polledOnce   = false;
  CloudAck      pending;                     /* an ack waiting to be written */
  bool          hasPending   = false;
  uint8_t       pendingTries = 0;

  for (;;) {
    /* Sleeping here is what lets core 0's idle task run. An RTOS task that
       never blocks starves it, and the task watchdog resets the chip. */
    vTaskDelay(pdMS_TO_TICKS(250));

    if (WiFi.status() != WL_CONNECTED) continue;   /* the driver reconnects itself */
    if (!cloudEnsureToken()) continue;

    unsigned long now = millis();

    /* 1. An acknowledgement from loop()? One at a time. */
    if (!hasPending && xQueueReceive(cloudAckQueue, &pending, 0) == pdTRUE) {
      hasPending   = true;
      pendingTries = 0;
    }

    /* 2. The latest numbers from loop(), copied whole under the lock. */
    CloudSnapshot snap;
    portENTER_CRITICAL(&cloudMux);
    snap = cloudSnap;
    portEXIT_CRITICAL(&cloudMux);

    if (snap.valid) {
      bool changed   = !everPushed ||
                       abs(snap.fill - pushed.fill) >= CLOUD_FILL_STEP ||
                       strcmp(snap.lid,    pushed.lid)    != 0 ||
                       strcmp(snap.status, pushed.status) != 0 ||
                       snap.locked  != pushed.locked ||
                       snap.opens   != pushed.opens  ||
                       snap.refused != pushed.refused;
      bool heartbeat = everPushed && (now - lastOkAt >= CLOUD_HEARTBEAT_MS);
      /* An ack goes out at once - that is what makes PING feel instant.
         Everything else, and every retry after a failure, waits 5 s. */
      bool gapOk     = !attempted || (now - lastAttempt >= CLOUD_MIN_PUSH_MS) ||
                       (hasPending && !lastFailed);

      if ((changed || heartbeat || hasPending) && gapOk) {
        attempted   = true;
        lastAttempt = now;
        if (cloudCommit(snap, hasPending ? &pending : NULL)) {
          pushed     = snap;
          everPushed = true;
          lastFailed = false;
          lastOkAt   = millis();
          if (hasPending) {
            Serial.printf("Cloud: acknowledged command %s\n", pending.id);
            hasPending = false;
          }
        } else {
          lastFailed = true;
          if (hasPending && ++pendingTries >= 3) {
            Serial.printf("Cloud: gave up acknowledging command %s\n", pending.id);
            hasPending = false;
          }
        }
      }
    }

    /* 3. Has a dashboard queued a command for us? */
    if (!polledOnce || now - lastPollAt >= CLOUD_POLL_MS) {
      polledOnce = true;
      lastPollAt = now;
      cloudPoll();
    }

    /* How much of the stack has never been touched - shown by CLOUD. If
       this ever nears zero, CLOUD_TASK_STACK is too small. */
    uint32_t freeStack = (uint32_t)uxTaskGetStackHighWaterMark(NULL);
    portENTER_CRITICAL(&cloudMux);
    cloudStat.stackFree = freeStack;
    portEXIT_CRITICAL(&cloudMux);
  }
}

/* A valid idToken, or false. Refreshes with 5 minutes to spare, and backs
   off after a failure: hammering Google's endpoints while the network is
   down achieves nothing and gets the account temporarily blocked. */
bool cloudEnsureToken() {
  /* The usual answer: the token we already hold is good for a while yet. */
  if (cloudSignedIn && millis() - cloudTokenAt < cloudTokenLifeMs - CLOUD_TOKEN_SLACK_MS) {
    return true;
  }

  /* EVERYTHING below this line makes an HTTPS request, so it all sits
     behind the back-off gate - the refresh as much as the sign-in. (An
     earlier version gated only the sign-in, so a refresh that kept failing
     was retried forever with no gap at all.) The cast to long makes the
     comparison survive the millis() rollover after 49 days. */
  if (cloudRetryGap > 0 && (long)(millis() - cloudRetryAt) < 0) return false;

  /* Prefer the refresh token - it gets a new hour without sending the
     password again. Fall back to a full sign-in when there is none, or
     when the refresh token has been revoked. */
  bool ok = (cloudSignedIn && cloudRefreshTok.length() > 0 && cloudRefresh()) ||
            cloudSignIn();
  if (ok) { cloudRetryGap = 0; return true; }

  cloudSignedIn = false;
  cloudRetryGap = (cloudRetryGap == 0) ? 15000UL : cloudRetryGap * 2;
  if (cloudRetryGap > 300000UL) cloudRetryGap = 300000UL;   /* cap at 5 min */
  cloudRetryAt  = millis() + cloudRetryGap;
  Serial.printf("Cloud: next sign-in attempt in %lu s\n", cloudRetryGap / 1000);
  return false;
}

/* Firebase Authentication REST: e-mail + password -> idToken. */
bool cloudSignIn() {
  String url  = String("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=")
              + FIREBASE_API_KEY;
  String body = String("{\"email\":\"") + jsonEscape(DEVICE_EMAIL) +
                "\",\"password\":\"" + jsonEscape(DEVICE_PASSWORD) +
                "\",\"returnSecureToken\":true}";
  String reply;
  int code = cloudHttp("POST", url, body, "application/json", false, reply);
  body = "";                                  /* do not keep the password in RAM */

  String token = (code == 200) ? jsonStringValue(reply, "idToken", 0) : String("");
  if (token.length() == 0) {
    cloudSignedIn = false;
    portENTER_CRITICAL(&cloudMux);
    cloudStat.signedIn = false;
    portEXIT_CRITICAL(&cloudMux);
    if (code < 0) {
      Serial.printf("Cloud: sign-in failed - network error %d (%s)\n",
                    code, HTTPClient::errorToString(code).c_str());
    } else {
      /* Google's reason is a fixed word such as INVALID_LOGIN_CREDENTIALS. */
      Serial.printf("Cloud: sign-in refused (HTTP %d %s) - check DEVICE_EMAIL and DEVICE_PASSWORD in secrets.h\n",
                    code, jsonStringValue(reply, "message", 0).c_str());
    }
    return false;
  }

  long life        = jsonStringValue(reply, "expiresIn", 0).toInt();   /* "3600" */
  cloudIdToken     = token;
  cloudRefreshTok  = jsonStringValue(reply, "refreshToken", 0);
  cloudTokenLifeMs = (unsigned long)(life >= 600 ? life : 3600) * 1000UL;
  cloudTokenAt     = millis();
  cloudSignedIn    = true;

  String uid = jsonStringValue(reply, "localId", 0);
  portENTER_CRITICAL(&cloudMux);
  cloudStat.signedIn = true;
  strlcpy(cloudStat.uid, uid.c_str(), sizeof(cloudStat.uid));
  portEXIT_CRITICAL(&cloudMux);

  /* The UID is not a secret - the owner needs it to map this board to its bin. */
  Serial.printf("Cloud: signed in - device UID %s (deviceBins() must map it to %s)\n",
                uid.c_str(), DEVICE_ID);
  return true;
}

/* Secure Token REST: refreshToken -> a fresh idToken, with no password. */
bool cloudRefresh() {
  String url  = String("https://securetoken.googleapis.com/v1/token?key=") + FIREBASE_API_KEY;
  /* Refresh tokens only contain URL-safe characters, so no encoding needed. */
  String body = "grant_type=refresh_token&refresh_token=" + cloudRefreshTok;
  String reply;
  int code = cloudHttp("POST", url, body, "application/x-www-form-urlencoded", false, reply);

  String token = (code == 200) ? jsonStringValue(reply, "id_token", 0) : String("");
  if (token.length() == 0) {
    Serial.printf("Cloud: token refresh failed (HTTP %d) - signing in again\n", code);
    return false;
  }
  long   life  = jsonStringValue(reply, "expires_in", 0).toInt();
  String fresh = jsonStringValue(reply, "refresh_token", 0);
  cloudIdToken     = token;
  if (fresh.length() > 0) cloudRefreshTok = fresh;
  cloudTokenLifeMs = (unsigned long)(life >= 600 ? life : 3600) * 1000UL;
  cloudTokenAt     = millis();
  Serial.println(F("Cloud: token refreshed"));
  return true;
}

/* One Firestore commit = one document write: the telemetry, plus the
   acknowledgement when there is one. The server stamps reportedAt / at
   itself (REQUEST_TIME), because the board has no trustworthy clock and
   the rules refuse any time that is not the server's own. */
bool cloudCommit(const CloudSnapshot& s, const CloudAck* ack) {
  /* Every device.* path we write. Keep in step with the fields below. */
  static const char* const DEVICE_FIELDS[] = {
    "fill", "fillA", "fillB", "lid", "status", "locked",
    "opens", "refused", "errors", "sensors", "rssi", "firmware"
  };

  String b;
  b.reserve(1100);
  b += "{\"writes\":[{\"update\":{\"name\":\"";
  b += cloudDocName();
  b += "\",\"fields\":{\"device\":{\"mapValue\":{\"fields\":{";
  b += fsInt("fill",    s.fill)    + ",";
  b += fsInt("fillA",   s.fillA)   + ",";
  b += fsInt("fillB",   s.fillB)   + ",";
  b += fsStr("lid",     s.lid)     + ",";
  b += fsStr("status",  s.status)  + ",";
  b += fsBool("locked", s.locked)  + ",";
  b += fsInt("opens",   s.opens)   + ",";
  b += fsInt("refused", s.refused) + ",";
  b += fsInt("errors",  s.errors)  + ",";
  b += fsInt("sensors", s.sensors) + ",";
  b += fsInt("rssi",    s.rssi)    + ",";
  b += fsStr("firmware", FIRMWARE_V);
  b += "}}}";
  if (ack) {
    b += ",\"commandAck\":{\"mapValue\":{\"fields\":{";
    b += fsStr("id", ack->id) + "," + fsStr("result", ack->result);
    b += "}}}";
  }
  /* The mask names each leaf, so the rest of the document - the command,
     the dashboards' own fields - is left exactly as it was. */
  b += "}},\"updateMask\":{\"fieldPaths\":[";
  for (size_t i = 0; i < sizeof(DEVICE_FIELDS) / sizeof(DEVICE_FIELDS[0]); i++) {
    if (i > 0) b += ",";
    b += "\"device.";
    b += DEVICE_FIELDS[i];
    b += "\"";
  }
  if (ack) b += ",\"commandAck.id\",\"commandAck.result\"";
  b += "]},\"updateTransforms\":[";
  b += "{\"fieldPath\":\"device.reportedAt\",\"setToServerValue\":\"REQUEST_TIME\"}";
  if (ack) b += ",{\"fieldPath\":\"commandAck.at\",\"setToServerValue\":\"REQUEST_TIME\"}";
  b += "]}]}";

  String url = String("https://firestore.googleapis.com/v1/projects/") + FIREBASE_PROJECT +
               "/databases/(default)/documents:commit";
  String reply;
  if (cloudFirestore("POST", url, b, reply) != 200) return false;

  portENTER_CRITICAL(&cloudMux);
  cloudStat.lastPushAt = millis();
  cloudStat.pushes++;
  portEXIT_CRITICAL(&cloudMux);

  if (cloudFirstPush) {
    cloudFirstPush = false;
    Serial.printf("Cloud: first report written - %s is now live on the dashboards\n", DEVICE_ID);
  }
  return true;
}

/* Reads ONLY the command field (mask.fieldPaths) - one small read. */
void cloudPoll() {
  String url = String("https://firestore.googleapis.com/v1/") + cloudDocName() +
               "?mask.fieldPaths=command";
  String reply;
  int code = cloudFirestore("GET", url, String(), reply);
  if (code != 200 && code != 404) return;          /* try again next time */

  portENTER_CRITICAL(&cloudMux);
  cloudStat.polls++;
  portEXIT_CRITICAL(&cloudMux);

  String cmd, id;
  int at = (code == 200) ? reply.indexOf("\"command\"") : -1;
  if (at >= 0) {
    cmd = firestoreString(reply, "cmd", at);
    id  = firestoreString(reply, "id",  at);
    cmd.toUpperCase();
  }

  /* First good poll since boot: remember, never replay (see banner above). */
  if (!cloudBaselined) {
    cloudBaselined = true;
    cloudLastCmdId = id;
    if (id.length() > 0 && cloudIdIsSafe(id)) {
      portENTER_CRITICAL(&cloudMux);
      strlcpy(cloudStat.lastCmdId, id.c_str(), sizeof(cloudStat.lastCmdId));
      portEXIT_CRITICAL(&cloudMux);
      Serial.printf("Cloud: command id %s was already waiting at boot - recorded, NOT replayed\n",
                    id.c_str());
    }
    Serial.println(F("Cloud: listening for dashboard commands every 10 s"));
    return;
  }

  if (id.length() == 0 || id == cloudLastCmdId) return;    /* nothing new */
  cloudLastCmdId = id;

  /* The id is the one thing we echo back, so it must be plain letters,
     digits, '-' or '_'. Anything else is dropped, not escaped. */
  if (!cloudIdIsSafe(id)) {
    Serial.println(F("Cloud: ignored a command with a malformed id"));
    return;
  }
  portENTER_CRITICAL(&cloudMux);
  strlcpy(cloudStat.lastCmdId, id.c_str(), sizeof(cloudStat.lastCmdId));
  portEXIT_CRITICAL(&cloudMux);

  if (!cloudCmdAllowed(cmd)) {
    Serial.printf("Cloud: command id %s refused - not one of OPEN CLOSE AUTO MUTE UNMUTE EMPTY PING\n",
                  id.c_str());
    CloudAck a;
    strlcpy(a.id,     id.c_str(),                      sizeof(a.id));
    strlcpy(a.result, "refused - command not allowed", sizeof(a.result));
    xQueueSend(cloudAckQueue, &a, 0);
    return;
  }

  CloudCommand c;
  strlcpy(c.cmd, cmd.c_str(), sizeof(c.cmd));
  strlcpy(c.id,  id.c_str(),  sizeof(c.id));
  if (xQueueSend(cloudCmdQueue, &c, 0) != pdTRUE) {
    Serial.println(F("Cloud: command queue full - command dropped"));
  }
}

/* One HTTPS request. Returns the HTTP status, or a negative HTTPClient
   error when the network failed. Blocks for up to ~5 s - which is exactly
   why it only ever runs on the cloud task, never in loop(). */
int cloudHttp(const char* method, const String& url, const String& body,
              const char* contentType, bool withToken, String& reply) {
  HTTPClient http;
  reply = "";
  http.setReuse(false);                      /* one request, one connection */
  http.setConnectTimeout(5000);
  http.setTimeout(5000);
  if (!http.begin(*cloudTls, url)) return HTTPC_ERROR_CONNECTION_REFUSED;
  if (contentType) http.addHeader("Content-Type", contentType);
  if (withToken)   http.addHeader("Authorization", "Bearer " + cloudIdToken);

  int code = (strcmp(method, "GET") == 0) ? http.GET() : http.sendRequest(method, body);
  if (code > 0) reply = http.getString();
  http.end();
  return code;
}

/* A Firestore request with the token attached. On 401 (token no longer
   accepted) it signs in again and retries - once. */
int cloudFirestore(const char* method, const String& url, const String& body,
                   String& reply) {
  const char* type = (strcmp(method, "GET") == 0) ? NULL : "application/json";
  int code = cloudHttp(method, url, body, type, true, reply);
  if (code == 401) {
    Serial.println(F("Cloud: 401 - token rejected, signing in again"));
    cloudSignedIn = false;
    if (cloudSignIn()) code = cloudHttp(method, url, body, type, true, reply);
  }
  cloudNoteHttp(code, reply);
  return code;
}

/* Records the result for the CLOUD command, and explains a failure ONCE,
   when the code changes, instead of every 10 seconds. */
void cloudNoteHttp(int code, const String& reply) {
  int prev;
  portENTER_CRITICAL(&cloudMux);
  prev = cloudStat.lastHttp;
  cloudStat.lastHttp = code;
  portEXIT_CRITICAL(&cloudMux);
  if (code == prev) return;

  if (code == 200) {
    Serial.println(F("Cloud: HTTP 200 - Firestore accepted the request"));
  } else if (code == 403) {
    Serial.println(F("Cloud: 403 - rules not published, or this device's UID is not in deviceBins()"));
  } else if (code == 404) {
    /* polling before the first report created the document - harmless */
  } else if (code < 0) {
    Serial.printf("Cloud: network error %d (%s) - will retry\n",
                  code, HTTPClient::errorToString(code).c_str());
  } else {
    Serial.printf("Cloud: HTTP %d %s\n", code, jsonStringValue(reply, "message", 0).c_str());
  }
}

/* ---- Small helpers --------------------------------------------------- */

String cloudDocName() {
  return String("projects/") + FIREBASE_PROJECT + "/databases/(default)/documents/bins/" + DEVICE_ID;
}

/* Finds "key": "value" in a JSON reply and returns value. Google pretty-
   prints its replies, so spaces and newlines around the colon are skipped.
   This is NOT a general JSON parser - it reads the few flat, known replies
   used here, and returns "" for anything unexpected. */
String jsonStringValue(const String& body, const char* key, int from) {
  String pat = String("\"") + key + "\"";
  int i = body.indexOf(pat, from);
  if (i < 0) return "";
  int n = (int)body.length();
  i += pat.length();
  while (i < n && isspace((unsigned char)body[i])) i++;
  if (i >= n || body[i] != ':') return "";
  i++;
  while (i < n && isspace((unsigned char)body[i])) i++;
  if (i >= n || body[i] != '"') return "";   /* not a string value */
  int end = body.indexOf('"', i + 1);
  if (end < 0) return "";
  return body.substring(i + 1, end);
}

/* Firestore wraps every value in its type:  "cmd": { "stringValue": "OPEN" }.
   Returns the string, or "" when the key is missing or is not a string. */
String firestoreString(const String& body, const char* key, int from) {
  String pat = String("\"") + key + "\"";
  int k = body.indexOf(pat, from);
  if (k < 0) return "";
  int close = body.indexOf('}', k);
  int sv    = body.indexOf("\"stringValue\"", k);
  if (sv < 0 || (close >= 0 && sv > close)) return "";   /* belongs to another key */
  return jsonStringValue(body, "stringValue", sv);
}

/* Only for DEVICE_EMAIL / DEVICE_PASSWORD, which the owner typed into
   secrets.h - a quote or backslash in a password must not break the JSON. */
String jsonEscape(const char* s) {
  String out;
  for (; *s; s++) {
    if (*s == '"' || *s == '\\') out += '\\';
    if ((unsigned char)*s >= 0x20) out += *s;
  }
  return out;
}

/* Firestore's typed JSON. integerValue is a STRING on purpose: JSON numbers
   cannot hold every 64-bit integer, so Firestore sends them as text. */
String fsInt(const char* key, int v) {
  return String("\"") + key + "\":{\"integerValue\":\"" + String(v) + "\"}";
}
String fsStr(const char* key, const char* v) {   /* v: fixed words and checked ids only */
  return String("\"") + key + "\":{\"stringValue\":\"" + v + "\"}";
}
String fsBool(const char* key, bool v) {
  return String("\"") + key + "\":{\"booleanValue\":" + (v ? "true" : "false") + "}";
}

bool cloudIdIsSafe(const String& id) {
  if (id.length() == 0 || id.length() > 40) return false;
  for (unsigned int i = 0; i < id.length(); i++) {
    char c = id[i];
    if (!isalnum((unsigned char)c) && c != '-' && c != '_') return false;
  }
  return true;
}

/* The only commands the cloud may send. STATUS / HELP / WIFI / CLOUD are
   for a person at the serial port, not for a remote dashboard. */
bool cloudCmdAllowed(const String& cmd) {
  return cmd == "OPEN"   || cmd == "CLOSE" || cmd == "AUTO" || cmd == "MUTE" ||
         cmd == "UNMUTE" || cmd == "EMPTY" || cmd == "PING";
}
#endif  /* CLOUD_SYNC */

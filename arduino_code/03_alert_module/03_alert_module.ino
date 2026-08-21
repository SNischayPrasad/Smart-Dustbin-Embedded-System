/**************************************************************
 *  SMART DUSTBIN - MODULE C: ALERT OUTPUTS
 *  ------------------------------------------------------------
 *  GOAL OF THIS SKETCH
 *  Test the two LEDs and the buzzer on their own, and prove the
 *  alert pattern is generated WITHOUT using delay().
 *
 *  This sketch simulates the fill level rising from 0 to 100 %
 *  so you can watch every alert state without touching a sensor.
 *
 *  WIRING
 *    Green LED : D10 -> 220 ohm -> LED anode, cathode -> GND
 *    Red LED   : D12 -> 220 ohm -> LED anode, cathode -> GND
 *    Buzzer    : D7  -> buzzer +, buzzer - -> GND
 *
 *  ALERT POLICY
 *    0-74 %    green ON,  red OFF,          buzzer silent
 *    75-89 %   green ON,  red slow blink,   buzzer silent
 *    90-100 %  green OFF, red solid ON,     beep 200ms / 1.8s
 *    error     green OFF, red fast blink,   buzzer silent
 **************************************************************/

/* ---------------- PIN MAP ---------------- */
const uint8_t PIN_BUZZER    = 7;
const uint8_t PIN_LED_GREEN = 10;
const uint8_t PIN_LED_RED   = 12;

/* ---------------- TUNING ----------------- */
const float LEVEL_WARN_PERCENT = 75.0;
const float LEVEL_FULL_PERCENT = 90.0;

const unsigned long BEEP_ON_MS  = 200;
const unsigned long BEEP_OFF_MS = 1800;

/* ---------------- STATE ------------------ */
float         simulatedFill  = 0;      /* climbs 0 -> 100 -> 0 */
int           fillDirection  = 5;
unsigned long lastRamp       = 0;

bool          buzzerOn       = false;
unsigned long buzzerChanged  = 0;
bool          blinkOn        = false;
unsigned long blinkChanged   = 0;

void setup() {
  Serial.begin(9600);
  Serial.println(F("Module C - Alert Output Test"));

  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED,   OUTPUT);
  pinMode(PIN_BUZZER,    OUTPUT);

  selfTest();
}

void loop() {
  unsigned long now = millis();

  /* Ramp the fake fill level every 700 ms so the demo is watchable */
  if (now - lastRamp >= 700) {
    lastRamp      = now;
    simulatedFill += fillDirection;
    if (simulatedFill >= 100) { simulatedFill = 100; fillDirection = -5; }
    if (simulatedFill <= 0)   { simulatedFill = 0;   fillDirection =  5; }

    Serial.print(F("Simulated fill: "));
    Serial.print(simulatedFill, 0);
    Serial.print(F("%  -> "));
    if      (simulatedFill >= LEVEL_FULL_PERCENT) Serial.println(F("FULL   (red + buzzer)"));
    else if (simulatedFill >= LEVEL_WARN_PERCENT) Serial.println(F("WARNING(red blink)"));
    else                                          Serial.println(F("OK     (green)"));
  }

  updateAlerts(simulatedFill, now);
}

/**************************************************************
 *  updateAlerts()
 *  Called thousands of times per second. It NEVER blocks - the
 *  beep pattern is produced by comparing millis() timestamps.
 **************************************************************/
void updateAlerts(float fillPercent, unsigned long now) {

  if (fillPercent >= LEVEL_FULL_PERCENT) {
    digitalWrite(PIN_LED_GREEN, LOW);
    digitalWrite(PIN_LED_RED,   HIGH);

    if (buzzerOn && (now - buzzerChanged >= BEEP_ON_MS)) {
      buzzerOn = false; digitalWrite(PIN_BUZZER, LOW);  buzzerChanged = now;
    } else if (!buzzerOn && (now - buzzerChanged >= BEEP_OFF_MS)) {
      buzzerOn = true;  digitalWrite(PIN_BUZZER, HIGH); buzzerChanged = now;
    }

  } else if (fillPercent >= LEVEL_WARN_PERCENT) {
    digitalWrite(PIN_LED_GREEN, HIGH);
    digitalWrite(PIN_LED_RED,   blinkPhase(now, 500) ? HIGH : LOW);
    digitalWrite(PIN_BUZZER,    LOW);
    buzzerOn = false;

  } else {
    digitalWrite(PIN_LED_GREEN, HIGH);
    digitalWrite(PIN_LED_RED,   LOW);
    digitalWrite(PIN_BUZZER,    LOW);
    buzzerOn = false;
  }
}

/* Non-blocking square wave used for blinking. */
bool blinkPhase(unsigned long now, unsigned long periodMs) {
  if (now - blinkChanged >= periodMs) {
    blinkOn      = !blinkOn;
    blinkChanged = now;
  }
  return blinkOn;
}

/**************************************************************
 *  selfTest()
 *  Flash everything once at power-on. An installer standing at
 *  the bin can then confirm no wire is loose without any tools.
 **************************************************************/
void selfTest() {
  Serial.println(F("Power-on self test..."));
  digitalWrite(PIN_LED_GREEN, HIGH); delay(300);
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED,   HIGH); delay(300);
  digitalWrite(PIN_LED_RED,   LOW);
  digitalWrite(PIN_BUZZER,    HIGH); delay(200);
  digitalWrite(PIN_BUZZER,    LOW);
  Serial.println(F("Self test done."));
}

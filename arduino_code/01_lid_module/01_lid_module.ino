/**************************************************************
 *  SMART DUSTBIN - MODULE A: AUTOMATIC LID
 *  ------------------------------------------------------------
 *  GOAL OF THIS SKETCH
 *  Prove that ONE ultrasonic sensor can detect a hand and that
 *  the servo opens and closes the lid reliably.
 *
 *  Build this FIRST. Do not move on until the lid behaves
 *  perfectly - every later bug is easier to find when you know
 *  this part already works.
 *
 *  WIRING
 *    HC-SR04 #1 : VCC->5V  GND->GND  TRIG->D2  ECHO->D3
 *    Servo      : Red->5V  Brown->GND  Orange->D6
 *
 *  EXPECTED BEHAVIOUR
 *    Hand within 25 cm  -> lid swings to 90 degrees
 *    Hand removed       -> lid waits 3 s, then returns to 0
 **************************************************************/

#include <Servo.h>

/* ---------------- PIN MAP ---------------- */
const uint8_t PIN_TRIG_LID = 2;
const uint8_t PIN_ECHO_LID = 3;
const uint8_t PIN_SERVO    = 6;

/* ---------------- TUNING ----------------- */
const float         HAND_DETECT_CM   = 25.0;   /* trigger distance */
const unsigned long LID_OPEN_HOLD_MS = 3000;   /* stay open        */
const int           ANGLE_CLOSED     = 0;
const int           ANGLE_OPEN       = 90;

/* ---------------- OBJECTS ---------------- */
Servo lidServo;

/* ---------------- STATE ------------------ */
bool          lidOpen        = false;
unsigned long lastSeenHandAt = 0;

void setup() {
  Serial.begin(9600);
  Serial.println(F("Module A - Automatic Lid Test"));

  pinMode(PIN_TRIG_LID, OUTPUT);
  pinMode(PIN_ECHO_LID, INPUT);

  lidServo.attach(PIN_SERVO);
  lidServo.write(ANGLE_CLOSED);     /* always boot closed */
  delay(500);
}

void loop() {
  unsigned long now = millis();
  float distance    = readDistanceCm(PIN_TRIG_LID, PIN_ECHO_LID);

  bool handDetected = (distance > 0) && (distance <= HAND_DETECT_CM);

  if (handDetected) {
    lastSeenHandAt = now;

    if (!lidOpen) {                 /* rising edge -> open once */
      lidServo.write(ANGLE_OPEN);
      lidOpen = true;
      Serial.println(F(">>> HAND DETECTED - LID OPENING"));
    }
  }

  /* Close only after the hold time has fully elapsed. The timer
     restarts on every detection, so a user throwing three items
     never gets the lid closed on their fingers.                 */
  if (lidOpen && (now - lastSeenHandAt >= LID_OPEN_HOLD_MS)) {
    lidServo.write(ANGLE_CLOSED);
    lidOpen = false;
    Serial.println(F("<<< NO HAND - LID CLOSING"));
  }

  Serial.print(F("Distance: "));
  if (distance < 0) Serial.print(F("out of range"));
  else            { Serial.print(distance, 1); Serial.print(F(" cm")); }
  Serial.print(F("   Lid: "));
  Serial.println(lidOpen ? F("OPEN") : F("CLOSED"));

  delay(100);   /* 10 readings per second is plenty for a lid */
}

/**************************************************************
 *  readDistanceCm()
 *  Sends a 10 us trigger pulse, measures the echo, converts the
 *  round-trip time to centimetres.
 *  Returns -1 when nothing echoed back inside the timeout.
 **************************************************************/
float readDistanceCm(uint8_t trigPin, uint8_t echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  unsigned long duration = pulseIn(echoPin, HIGH, 25000UL);
  if (duration == 0) return -1.0;

  /* Sound travels 0.0343 cm per microsecond, there and back,
     so cm = microseconds / 58.31                              */
  float cm = duration / 58.31;

  if (cm < 2.0 || cm > 400.0) return -1.0;   /* outside datasheet range */
  return cm;
}

/**************************************************************
 *  SMART DUSTBIN - MODULE B: WASTE LEVEL WITH TWO SENSORS
 *  ------------------------------------------------------------
 *  GOAL OF THIS SKETCH
 *  Turn TWO downward distance readings into ONE trustworthy
 *  fill percentage.
 *
 *  THE PROBLEM WITH A SINGLE SENSOR
 *
 *     [ sensor A ]                     [ sensor B ]
 *          |  ^                             |  ^
 *          |  | distA                       |  | distB
 *          |  v                             |  v
 *      ~~~~~~~~~~~~~~~\                     |
 *                      \~~~~~~~~~~~~~~~~~~~~~
 *          ^ a peak here          a hollow here ^
 *      ____|_________________________________|____  bin floor
 *
 *  Rubbish is never flat. One sensor sitting over a peak shouts
 *  "FULL" while the bin is half empty; one over a hollow says
 *  "nearly empty" while the far side is overflowing.
 *
 *  TWO SENSORS ON OPPOSITE DIAGONALS GIVE THREE THINGS
 *    1. ACCURACY   - the average of two points is much closer to
 *                    the real volume than a single point.
 *    2. REDUNDANCY - if one fails, keep working on the other.
 *    3. DIAGNOSIS  - a big gap between A and B means the load is
 *                    piled to one side and needs levelling.
 *
 *  WIRING
 *    HC-SR04 A : VCC->5V  GND->GND  TRIG->D4  ECHO->D5
 *    HC-SR04 B : VCC->5V  GND->GND  TRIG->D8  ECHO->D9
 *
 *  CALIBRATION STEP (do this once, on the real bin)
 *  Empty the bin, run this sketch, and read the two printed
 *  distances. They should agree within a centimetre or so. THAT
 *  number is your BIN_HEIGHT_CM. Do not guess it.
 **************************************************************/

/* ---------------- PIN MAP ---------------- */
const uint8_t PIN_TRIG_A = 4;
const uint8_t PIN_ECHO_A = 5;
const uint8_t PIN_TRIG_B = 8;
const uint8_t PIN_ECHO_B = 9;

/* ---------------- TUNING ----------------- */
const float BIN_HEIGHT_CM      = 30.0;   /* measured when empty  */
const float LEVEL_WARN_PERCENT = 75.0;   /* schedule a pickup    */
const float LEVEL_FULL_PERCENT = 90.0;   /* collect now          */
const float LEVEL_DISAGREE_PCT = 25.0;   /* A vs B = uneven load */
const float INVALID            = -1.0;
const unsigned long SETTLE_MS  = 12;     /* anti-crosstalk gap   */

void setup() {
  Serial.begin(9600);
  Serial.println(F("Module B - Dual Sensor Bin Level Test"));
  Serial.print  (F("Bin height configured as "));
  Serial.print  (BIN_HEIGHT_CM, 1);
  Serial.println(F(" cm"));
  Serial.println(F("--------------------------------------------"));

  pinMode(PIN_TRIG_A, OUTPUT);  pinMode(PIN_ECHO_A, INPUT);
  pinMode(PIN_TRIG_B, OUTPUT);  pinMode(PIN_ECHO_B, INPUT);
}

void loop() {
  /* Fire A, let its echoes die, then fire B. If both fired at the
     same instant each would hear the other and report nonsense.  */
  float dA = readDistanceMedian(PIN_TRIG_A, PIN_ECHO_A);
  delay(SETTLE_MS);
  float dB = readDistanceMedian(PIN_TRIG_B, PIN_ECHO_B);

  float fillA = calculateFillPercent(dA);
  float fillB = calculateFillPercent(dB);

  /* ---- fuse the two readings ---- */
  float fill;
  float spread    = 0;
  bool  uneven    = false;
  uint8_t valid   = 0;

  if (fillA != INVALID && fillB != INVALID) {
    valid  = 2;
    fill   = (fillA + fillB) / 2.0;
    spread = fabs(fillA - fillB);
    uneven = (spread > LEVEL_DISAGREE_PCT);
  } else if (fillA != INVALID) {
    valid = 1; fill = fillA;
  } else if (fillB != INVALID) {
    valid = 1; fill = fillB;
  } else {
    Serial.println(F("SENSOR ERROR - neither level sensor answered"));
    delay(1000);
    return;
  }

  /* ---- report ---- */
  Serial.print(F("A: "));
  if (dA == INVALID) Serial.print(F("--.- cm (no echo)"));
  else { Serial.print(dA, 1); Serial.print(F(" cm = ")); Serial.print(fillA, 0); Serial.print(F("%")); }

  Serial.print(F("   |   B: "));
  if (dB == INVALID) Serial.print(F("--.- cm (no echo)"));
  else { Serial.print(dB, 1); Serial.print(F(" cm = ")); Serial.print(fillB, 0); Serial.print(F("%")); }

  Serial.print(F("   |   FUSED: ")); Serial.print(fill, 0); Serial.print(F("%  "));

  if      (fill >= LEVEL_FULL_PERCENT) Serial.print(F("FULL - COLLECT NOW"));
  else if (fill >= LEVEL_WARN_PERCENT) Serial.print(F("WARNING - NEARLY FULL"));
  else                                 Serial.print(F("OK"));

  if (uneven)      { Serial.print(F("  [UNEVEN LOAD, spread ")); Serial.print(spread, 0); Serial.print(F("%]")); }
  if (valid == 1)    Serial.print(F("  [DEGRADED: running on 1 sensor]"));
  Serial.println();

  printBar(fill);
  delay(1000);
}

/**************************************************************
 *  calculateFillPercent()   - one sensor, pure maths
 *    30 cm -> 0 %      22.5 cm -> 25 %     15 cm -> 50 %
 *    7.5 cm -> 75 %     3 cm  -> 90 %       0 cm -> 100 %
 **************************************************************/
float calculateFillPercent(float measuredDistanceCm) {
  /* Any negative value is the "no echo" sentinel. A real distance can
     never be negative, so there is nothing to clamp - it is missing data. */
  if (measuredDistanceCm < 0) return INVALID;

  if (measuredDistanceCm > BIN_HEIGHT_CM) measuredDistanceCm = BIN_HEIGHT_CM;

  float fillLevel   = BIN_HEIGHT_CM - measuredDistanceCm;
  float fillPercent = (fillLevel / BIN_HEIGHT_CM) * 100.0;

  if (fillPercent < 0)   fillPercent = 0;
  if (fillPercent > 100) fillPercent = 100;
  return fillPercent;
}

/**************************************************************
 *  printBar()
 *  A 20-character text gauge, so the Serial Monitor screenshot
 *  looks good in your report.   [##########----------] 50%
 **************************************************************/
void printBar(float percent) {
  int filled = (int)((percent / 100.0) * 20.0 + 0.5);
  Serial.print(F("     ["));
  for (int i = 0; i < 20; i++) Serial.print(i < filled ? "#" : "-");
  Serial.print(F("] "));
  Serial.print(percent, 0);
  Serial.println(F("%"));
}

/**************************************************************
 *  readDistanceMedian()
 *  Three pings, middle value wins. One stray reflection off a
 *  crumpled bag cannot move a median.
 **************************************************************/
float readDistanceMedian(uint8_t trigPin, uint8_t echoPin) {
  float a = readDistanceCm(trigPin, echoPin); delay(SETTLE_MS);
  float b = readDistanceCm(trigPin, echoPin); delay(SETTLE_MS);
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

float readDistanceCm(uint8_t trigPin, uint8_t echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  unsigned long duration = pulseIn(echoPin, HIGH, 25000UL);
  if (duration == 0) return INVALID;

  float cm = duration / 58.31;
  if (cm < 2.0 || cm > 400.0) return INVALID;
  return cm;
}

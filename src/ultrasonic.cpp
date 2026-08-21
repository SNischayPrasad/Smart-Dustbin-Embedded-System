#include "ultrasonic.h"
#include "config.h"

/* --------------------------------------------------------------
 *  ultrasonicInit()
 *  Sets pin directions. TRIG is an OUTPUT (we talk), ECHO is an
 *  INPUT (we listen). Called once from setup().
 * ------------------------------------------------------------ */
void ultrasonicInit(Ultrasonic *s, uint8_t trigPin, uint8_t echoPin) {
  s->trigPin  = trigPin;
  s->echoPin  = echoPin;
  s->lastGood = INVALID_READING;

  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);          // let the line settle
}

/* --------------------------------------------------------------
 *  ultrasonicIsValid()
 *  A reading is trusted only if it is inside the datasheet range.
 *  0 means pulseIn() timed out (nothing in front / too far).
 * ------------------------------------------------------------ */
bool ultrasonicIsValid(float cm) {
  return (cm >= SENSOR_DEAD_ZONE_CM && cm <= MAX_VALID_CM);
}

/* --------------------------------------------------------------
 *  ultrasonicReadRaw()
 *  Fires ONE ping and converts the echo time to centimetres.
 *  Returns INVALID_READING (-1) when no echo came back.
 * ------------------------------------------------------------ */
float ultrasonicReadRaw(Ultrasonic *s) {
  /* 1. Clean LOW, then the mandatory 10 us trigger pulse */
  digitalWrite(s->trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(s->trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(s->trigPin, LOW);

  /* 2. Measure how long ECHO stays HIGH (microseconds).
        The timeout stops us hanging forever if the echo is lost. */
  unsigned long duration = pulseIn(s->echoPin, HIGH, ULTRASONIC_TIMEOUT_US);

  if (duration == 0UL) {
    return INVALID_READING;      // timeout -> no object in range
  }

  /* 3. Convert time to distance.
        Sound = 343 m/s = 0.0343 cm/us.  Round trip -> divide by 2.
        1 / (0.0343 / 2) = 58.31  ->  cm = us / 58.31            */
  float cm = (float)duration / 58.31f;

  return ultrasonicIsValid(cm) ? cm : INVALID_READING;
}

/* --------------------------------------------------------------
 *  ultrasonicReadFiltered()
 *  Ultrasonic sensors occasionally return a wild spike (a stray
 *  reflection). Taking the MEDIAN of 3 readings throws that spike
 *  away, which is exactly what a product in the field must do.
 *
 *  If every sample fails we fall back to the last known good
 *  value so the system degrades gracefully instead of jumping.
 * ------------------------------------------------------------ */
float ultrasonicReadFiltered(Ultrasonic *s) {
  float samples[MEDIAN_SAMPLES];
  uint8_t good = 0;

  for (uint8_t i = 0; i < MEDIAN_SAMPLES; i++) {
    float v = ultrasonicReadRaw(s);
    if (v != INVALID_READING) {
      samples[good++] = v;
    }
    delay(12);   // HC-SR04 needs >10 ms between pings (no crosstalk)
  }

  if (good == 0) {
    return s->lastGood;          // may still be INVALID_READING
  }

  /* Simple insertion sort - only 3 elements, so this is fast. */
  for (uint8_t i = 1; i < good; i++) {
    float key = samples[i];
    int8_t j  = i - 1;
    while (j >= 0 && samples[j] > key) {
      samples[j + 1] = samples[j];
      j--;
    }
    samples[j + 1] = key;
  }

  s->lastGood = samples[good / 2];   // middle element = median
  return s->lastGood;
}

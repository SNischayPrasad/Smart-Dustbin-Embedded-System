/**************************************************************
 *  Smart Dustbin - Industry Oriented Embedded System
 *  File   : main.cpp   (PlatformIO entry point)
 *
 *  Three HC-SR04 sensors:
 *    #1 on the front  -> detects a hand, drives the lid
 *    #2 and #3 inside -> measure the waste level from two
 *                        diagonals, fused into one percentage
 *
 *  Same program as arduino_code/04_smart_dustbin_complete,
 *  split into modules the way a production codebase is organised.
 **************************************************************/
#include <Arduino.h>
#include "config.h"
#include "ultrasonic.h"
#include "lid.h"
#include "bin_level.h"
#include "alert.h"
#include "display.h"

/* ---- Objects -------------------------------------------------- */
static Ultrasonic handSensor;
static Ultrasonic levelSensorA;
static Ultrasonic levelSensorB;

/* ---- Shared system state -------------------------------------- */
static float        handDistance = INVALID_READING;
static float        distA        = INVALID_READING;
static float        distB        = INVALID_READING;
static LevelReading level;
static BinStatus    binStatus    = BIN_OK;

/* ---- Software timers (cooperative scheduler) ------------------ */
static unsigned long tLid = 0, tLevel = 0, tTelem = 0;

static void taskLid(unsigned long now);
static void taskLevel(unsigned long now);
static void taskTelemetry(unsigned long now);

void setup() {
  Serial.begin(9600);

  Serial.println(F("=============================================="));
  Serial.println(F(" Smart Dustbin - Embedded System"));
  Serial.print  (F(" Device: ")); Serial.print(DEVICE_ID);
  Serial.print  (F("  Firmware: v")); Serial.println(FIRMWARE_V);
  Serial.println(F(" Sensors: 1 hand + 2 in-bin level"));
  Serial.println(F("=============================================="));

  ultrasonicInit(&handSensor,   PIN_TRIG_HAND,    PIN_ECHO_HAND);
  ultrasonicInit(&levelSensorA, PIN_TRIG_LEVEL_A, PIN_ECHO_LEVEL_A);
  ultrasonicInit(&levelSensorB, PIN_TRIG_LEVEL_B, PIN_ECHO_LEVEL_B);

  lidInit();
  alertInit();
  displayInit();
  displaySplash();

  level.fillPercent = 0.0f;
  level.validCount  = 0;

  Serial.println(F("Self-test complete. System running."));
}

void loop() {
  unsigned long now = millis();     /* read the clock ONCE per pass */

  if (now - tLid   >= LID_SAMPLE_MS)   { tLid   = now; taskLid(now);   }
  if (now - tLevel >= LEVEL_SAMPLE_MS) { tLevel = now; taskLevel(now); }
  if (now - tTelem >= TELEMETRY_MS)    { tTelem = now; taskTelemetry(now); }

  /* Cheap, must react instantly - so they run every pass. */
  alertUpdate(binStatus, now);
  displayUpdate(lidGetStateName(), level.fillPercent, binStatus);
}

/* ==============================================================
 *  TASK 1 - Hand detection and lid control
 * ============================================================ */
static void taskLid(unsigned long now) {
  handDistance = ultrasonicReadRaw(&handSensor);   /* fast single ping */

  bool handDetected = (handDistance != INVALID_READING) &&
                      (handDistance <= HAND_DETECT_CM);

  lidUpdate(handDetected, now);
}

/* ==============================================================
 *  TASK 2 - Waste level from the two in-bin sensors
 *  Skipped while the lid is open: with the lid up both sensors
 *  see the sky or the arm of the user instead of the rubbish.
 * ============================================================ */
static void taskLevel(unsigned long now) {
  (void)now;

  if (lidIsOpen()) return;

  distA = ultrasonicReadFiltered(&levelSensorA);
  delay(SENSOR_SETTLE_MS);            /* let the echoes die away */
  distB = ultrasonicReadFiltered(&levelSensorB);

  level     = binLevelFuse(distA, distB);
  binStatus = binLevelClassify(&level);
}

/* ==============================================================
 *  TASK 3 - Telemetry
 *  One human line for the Serial Monitor plus one JSON line that
 *  the website dashboard and any cloud bridge can parse.
 * ============================================================ */
static void taskTelemetry(unsigned long now) {
  Serial.print(F("[")); Serial.print(now / 1000); Serial.print(F("s] "));

  Serial.print(F("Hand="));
  if (handDistance == INVALID_READING) Serial.print(F("---"));
  else                                 Serial.print(handDistance, 1);

  Serial.print(F("cm  Lid=")); Serial.print(lidGetStateName());

  Serial.print(F("  A="));
  if (level.fillA == INVALID_READING) Serial.print(F("--"));
  else                                Serial.print(level.fillA, 0);
  Serial.print(F("%  B="));
  if (level.fillB == INVALID_READING) Serial.print(F("--"));
  else                                Serial.print(level.fillB, 0);

  Serial.print(F("%  Fill="));   Serial.print(level.fillPercent, 0);
  Serial.print(F("%  Status=")); Serial.print(binLevelStatusName(binStatus));
  if (level.uneven)          Serial.print(F("  [UNEVEN LOAD]"));
  if (level.validCount == 1) Serial.print(F("  [DEGRADED: 1 sensor]"));
  Serial.println();

  /* Machine-readable line for the dashboard / cloud bridge */
  Serial.print(F("{\"id\":\""));      Serial.print(DEVICE_ID);
  Serial.print(F("\",\"fill\":"));    Serial.print(level.fillPercent, 0);
  Serial.print(F(",\"fillA\":"));     Serial.print(level.fillA, 0);
  Serial.print(F(",\"fillB\":"));     Serial.print(level.fillB, 0);
  Serial.print(F(",\"spread\":"));    Serial.print(level.spread, 0);
  Serial.print(F(",\"uneven\":"));    Serial.print(level.uneven ? F("true") : F("false"));
  Serial.print(F(",\"sensors\":"));   Serial.print(level.validCount);
  Serial.print(F(",\"lid\":\""));     Serial.print(lidGetStateName());
  Serial.print(F("\",\"status\":\""));Serial.print(binLevelStatusName(binStatus));
  Serial.print(F("\",\"opens\":"));   Serial.print(lidGetOpenCount());
  Serial.println(F("}"));
}

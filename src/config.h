/**************************************************************
 *  Smart Dustbin - Industry Oriented Embedded System
 *  File   : config.h
 *  Purpose: Single place for every pin number, threshold and
 *           timing constant used by the firmware.
 *
 *  SENSOR LAYOUT (3 x HC-SR04)
 *    #1 HAND    - on the front face, looking outward.
 *    #2 LEVEL A - inside the bin, under the lid, front-left.
 *    #3 LEVEL B - inside the bin, under the lid, rear-right.
 *
 *  WHY TWO SENSORS INSIDE?
 *  Rubbish never forms a flat surface. A single downward sensor
 *  sitting over a peak reports "full" while the bin is half
 *  empty, and one sitting over a hollow reports the opposite.
 *  Two sensors on opposite diagonals give three things at once:
 *    1. ACCURACY   - the average of two points is much closer to
 *                    the real volume than one point.
 *    2. REDUNDANCY - if one sensor fails, the bin keeps working
 *                    on the other instead of going blind.
 *    3. DIAGNOSIS  - a large disagreement between the two means
 *                    the load is piled to one side, which is
 *                    worth reporting on its own.
 **************************************************************/
#ifndef CONFIG_H
#define CONFIG_H

/* ============================================================
 *  1. PIN MAP  (Arduino UNO)
 * ============================================================ */
#define PIN_TRIG_HAND     2   // Digital OUT -> HC-SR04 #1 TRIG
#define PIN_ECHO_HAND     3   // Digital IN  <- HC-SR04 #1 ECHO
#define PIN_TRIG_LEVEL_A  4   // Digital OUT -> HC-SR04 #2 TRIG
#define PIN_ECHO_LEVEL_A  5   // Digital IN  <- HC-SR04 #2 ECHO
#define PIN_SERVO         6   // PWM OUT     -> Servo signal (orange)
#define PIN_BUZZER        7   // Digital OUT -> Buzzer +
#define PIN_TRIG_LEVEL_B  8   // Digital OUT -> HC-SR04 #3 TRIG
#define PIN_ECHO_LEVEL_B  9   // Digital IN  <- HC-SR04 #3 ECHO
#define PIN_LED_GREEN    10   // Digital OUT -> Green LED (via 220R)
#define PIN_LED_RED      12   // Digital OUT -> Red LED   (via 220R)
/*  I2C LCD (optional) uses the fixed hardware pins:
 *  UNO  : SDA = A4 , SCL = A5
 *  ESP32: SDA = 21 , SCL = 22
 *
 *  Still free on the UNO: D11, D13, A0, A1, A2, A3            */

/* ============================================================
 *  2. PHYSICAL DIMENSIONS
 * ============================================================ */
#define BIN_HEIGHT_CM        30.0f  // Sensor face -> empty bin floor
#define SENSOR_DEAD_ZONE_CM   2.0f  // HC-SR04 cannot measure closer

/* ============================================================
 *  3. THRESHOLDS  (the "decision" numbers)
 * ============================================================ */
#define HAND_DETECT_CM       25.0f  // Hand closer than this -> open lid
#define LEVEL_WARN_PERCENT   75.0f  // Amber / "schedule pickup"
#define LEVEL_FULL_PERCENT   90.0f  // Red + buzzer / "collect NOW"
#define LEVEL_DISAGREE_PCT   25.0f  // A vs B gap that means "uneven load"

/* ============================================================
 *  4. TIMING (milliseconds) - all non-blocking
 * ============================================================ */
#define LID_OPEN_HOLD_MS      3000UL // Stay open after last detection
#define LID_TRAVEL_MS          400UL // Time the servo needs to sweep
#define LEVEL_SAMPLE_MS       1000UL // How often we measure waste level
#define LID_SAMPLE_MS           60UL // How often we look for a hand
#define TELEMETRY_MS          2000UL // Serial / Wi-Fi report interval
#define BUZZER_BEEP_ON_MS      200UL // Full-bin beep pattern: ON time
#define BUZZER_BEEP_OFF_MS    1800UL // Full-bin beep pattern: OFF time
#define SENSOR_SETTLE_MS        12UL // Gap between pings (anti-crosstalk)

/* ============================================================
 *  5. SERVO ANGLES
 * ============================================================ */
#define SERVO_ANGLE_CLOSED     0
#define SERVO_ANGLE_OPEN      90

/* ============================================================
 *  6. SENSOR RELIABILITY
 * ============================================================ */
#define ULTRASONIC_TIMEOUT_US 25000UL // ~4 m max range, then give up
#define MEDIAN_SAMPLES            3   // Median-of-3 spike rejection
#define MAX_VALID_CM          400.0f  // HC-SR04 datasheet maximum
#define INVALID_READING        -1.0f  // Sentinel for "no echo"

/* ============================================================
 *  7. BUILD OPTIONS - comment out to disable a feature
 * ============================================================ */
#define USE_LCD                      // I2C 16x2 LCD on A4/A5
#define LCD_I2C_ADDRESS      0x27    // Try 0x3F if screen stays blank

/* Device identity - shown on the dashboard */
#define DEVICE_ID   "BIN-001"
#define FIRMWARE_V  "2.0.0"

#endif /* CONFIG_H */

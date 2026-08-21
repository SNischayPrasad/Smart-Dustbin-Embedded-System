#include "lid.h"
#include "config.h"
#include <Servo.h>

static Servo        lidServo;
static LidState     state          = LID_CLOSED;
static unsigned long stateEnteredAt = 0;
static unsigned long lastSeenHandAt = 0;
static uint16_t     openCount      = 0;

/* Helper: change state and remember WHEN we changed. */
static void enterState(LidState s, unsigned long now) {
  state          = s;
  stateEnteredAt = now;
}

void lidInit(void) {
  lidServo.attach(PIN_SERVO);
  lidServo.write(SERVO_ANGLE_CLOSED);   // always boot in a safe state
  state          = LID_CLOSED;
  stateEnteredAt = millis();
  openCount      = 0;
}

/* --------------------------------------------------------------
 *  lidUpdate()
 *  Call this EVERY loop(). It never blocks.
 *
 *  handDetected : true when the lid sensor sees something close
 *  now          : millis() captured once at the top of loop()
 * ------------------------------------------------------------ */
void lidUpdate(bool handDetected, unsigned long now) {
  if (handDetected) {
    lastSeenHandAt = now;   // refresh the "keep open" timer
  }

  switch (state) {

    case LID_CLOSED:
      /* Trigger: a hand appeared -> command the servo open. */
      if (handDetected) {
        lidServo.write(SERVO_ANGLE_OPEN);
        openCount++;
        enterState(LID_OPENING, now);
      }
      break;

    case LID_OPENING:
      /* Give the servo time to physically travel before we say
         "open". Servos are slow compared to the CPU.            */
      if (now - stateEnteredAt >= LID_TRAVEL_MS) {
        enterState(LID_OPEN, now);
      }
      break;

    case LID_OPEN:
      /* Stay open while the user is still there. The hold timer
         restarts every time a hand is seen, so someone throwing
         several items never gets the lid shut on their hand.     */
      if (now - lastSeenHandAt >= LID_OPEN_HOLD_MS) {
        lidServo.write(SERVO_ANGLE_CLOSED);
        enterState(LID_CLOSING, now);
      }
      break;

    case LID_CLOSING:
      /* Safety re-open: if a hand comes back mid-close, abort. */
      if (handDetected) {
        lidServo.write(SERVO_ANGLE_OPEN);
        enterState(LID_OPENING, now);
      } else if (now - stateEnteredAt >= LID_TRAVEL_MS) {
        enterState(LID_CLOSED, now);
      }
      break;
  }
}

LidState lidGetState(void)  { return state; }
bool     lidIsOpen(void)    { return (state == LID_OPEN || state == LID_OPENING); }
uint16_t lidGetOpenCount(void) { return openCount; }

const char* lidGetStateName(void) {
  switch (state) {
    case LID_CLOSED:  return "CLOSED";
    case LID_OPENING: return "OPENING";
    case LID_OPEN:    return "OPEN";
    case LID_CLOSING: return "CLOSING";
  }
  return "UNKNOWN";
}

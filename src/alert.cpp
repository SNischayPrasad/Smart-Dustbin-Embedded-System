#include "alert.h"
#include "config.h"

static bool          buzzerEnabled = true;
static bool          buzzerOn      = false;
static unsigned long buzzerChanged = 0;
static unsigned long blinkChanged  = 0;
static bool          blinkOn       = false;

void alertInit(void) {
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED,   OUTPUT);
  pinMode(PIN_BUZZER,    OUTPUT);

  /* Power-on self test: everything blinks once so the installer
     can see at a glance that no wire is loose.                  */
  digitalWrite(PIN_LED_GREEN, HIGH);
  digitalWrite(PIN_LED_RED,   HIGH);
  digitalWrite(PIN_BUZZER,    HIGH);
  delay(300);
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED,   LOW);
  digitalWrite(PIN_BUZZER,    LOW);

  buzzerEnabled = true;
  buzzerOn      = false;
  buzzerChanged = millis();
  blinkChanged  = millis();
}

/* Non-blocking blink helper: returns the current on/off phase. */
static bool blinkPhase(unsigned long now, unsigned long periodMs) {
  if (now - blinkChanged >= periodMs) {
    blinkOn      = !blinkOn;
    blinkChanged = now;
  }
  return blinkOn;
}

void alertUpdate(BinStatus status, unsigned long now) {

  switch (status) {

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

      /* Periodic beep built from millis() - never blocks loop(). */
      if (!buzzerEnabled) {
        digitalWrite(PIN_BUZZER, LOW);
        buzzerOn = false;
      } else if (buzzerOn && (now - buzzerChanged >= BUZZER_BEEP_ON_MS)) {
        buzzerOn = false;  digitalWrite(PIN_BUZZER, LOW);  buzzerChanged = now;
      } else if (!buzzerOn && (now - buzzerChanged >= BUZZER_BEEP_OFF_MS)) {
        buzzerOn = true;   digitalWrite(PIN_BUZZER, HIGH); buzzerChanged = now;
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

void alertSetBuzzerEnabled(bool enabled) {
  buzzerEnabled = enabled;
  if (!enabled) digitalWrite(PIN_BUZZER, LOW);
}

bool alertIsBuzzerEnabled(void) { return buzzerEnabled; }

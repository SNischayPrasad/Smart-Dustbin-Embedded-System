/**************************************************************
 *  File   : alert.h
 *  Purpose: Drives the two LEDs and the buzzer.
 *
 *  ALERT POLICY
 *  ------------------------------------------------------------
 *   Status    Green LED   Red LED        Buzzer
 *   OK        ON          OFF            silent
 *   WARNING   ON          slow blink     silent
 *   FULL      OFF         ON solid       beep 200 ms / 1.8 s
 *   ERROR     OFF         fast blink     silent
 *
 *  The buzzer is intentionally a SHORT periodic beep, not a
 *  continuous siren - a dustbin screaming non-stop in a hospital
 *  corridor would be switched off by staff on day one.
 **************************************************************/
#ifndef ALERT_H
#define ALERT_H

#include <Arduino.h>
#include "bin_level.h"

void alertInit(void);
void alertUpdate(BinStatus status, unsigned long now);
void alertSetBuzzerEnabled(bool enabled);   // "silent hours" / remote mute
bool alertIsBuzzerEnabled(void);

#endif /* ALERT_H */

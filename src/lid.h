/**************************************************************
 *  File   : lid.h
 *  Purpose: Non-blocking state machine that drives the servo
 *           which opens and closes the dustbin lid.
 *
 *  WHY A STATE MACHINE INSTEAD OF delay()?
 *  A beginner writes:
 *        if (hand) { open(); delay(3000); close(); }
 *  During those 3000 ms the CPU is FROZEN - it cannot read the
 *  waste level, it cannot beep, it cannot talk to Wi-Fi.
 *  A state machine remembers "where am I" and returns instantly,
 *  so loop() keeps spinning thousands of times per second.
 *  This is how real embedded products are written.
 **************************************************************/
#ifndef LID_H
#define LID_H

#include <Arduino.h>

typedef enum {
  LID_CLOSED,     // resting, waiting for a hand
  LID_OPENING,    // servo is physically sweeping open
  LID_OPEN,       // fully open, holding for the user
  LID_CLOSING     // servo is sweeping back
} LidState;

void        lidInit(void);
void        lidUpdate(bool handDetected, unsigned long now);
LidState    lidGetState(void);
const char* lidGetStateName(void);
bool        lidIsOpen(void);
uint16_t    lidGetOpenCount(void);   // usage counter for maintenance

#endif /* LID_H */

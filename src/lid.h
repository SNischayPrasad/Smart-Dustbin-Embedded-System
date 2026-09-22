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
 *
 *  FULL-BIN LOCKDOWN
 *  When the caller says the bin is locked (it is FULL - see
 *  binLevelIsLocked()), a hand at a CLOSED lid is refused and
 *  counted instead of opening it. Two things still open it:
 *    - the safety re-open, when a hand returns while the lid is
 *      coming down: a lid must never close on somebody's hand, so
 *      safety beats lockdown, and
 *    - the operator's OPEN command, the crew override, which
 *      bypasses this state machine entirely.
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
/* binIsLocked: the bin is FULL, so a hand must NOT open a closed lid.
   Passed in rather than read from a global, so this module stays
   testable on its own and the policy has exactly one home. */
void        lidUpdate(bool handDetected, bool binIsLocked, unsigned long now);
LidState    lidGetState(void);
const char* lidGetStateName(void);
bool        lidIsOpen(void);
uint16_t    lidGetOpenCount(void);      // usage counter for maintenance
uint16_t    lidGetRefusedCount(void);   // approaches turned away while locked

#endif /* LID_H */

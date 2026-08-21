/**************************************************************
 *  File   : display.h
 *  Purpose: Optional 16x2 I2C LCD output.
 *
 *  The whole file compiles to NOTHING when USE_LCD is commented
 *  out in config.h, so the project still builds for students who
 *  do not own a display. This "feature flag" pattern is used in
 *  every real product that ships in several hardware variants.
 *
 *  LCD LAYOUT
 *      +----------------+
 *      |Lid:OPEN BIN-001|   row 0
 *      |Fill: 87% WARN  |   row 1
 *      +----------------+
 **************************************************************/
#ifndef DISPLAY_H
#define DISPLAY_H

#include <Arduino.h>
#include "bin_level.h"

void displayInit(void);
void displaySplash(void);
void displayUpdate(const char *lidState, float fillPercent, BinStatus status);

#endif /* DISPLAY_H */

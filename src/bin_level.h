/**************************************************************
 *  File   : bin_level.h
 *  Purpose: Turn TWO downward distance readings into one
 *           trustworthy fill percentage.
 *
 *  THE GEOMETRY (viewed from the side, lid closed)
 *
 *     [ sensor A ]                     [ sensor B ]
 *          |  ^                             |  ^
 *          |  | distA                       |  | distB
 *          |  v                             |  v
 *      ~~~~~~~~~~~~~~~\                     |
 *                      \~~~~~~~~~~~~~~~~~~~~~   <- uneven rubbish
 *          ^                                ^
 *          |  a peak here                   |  a hollow here
 *      ____|________________________________|____  <- bin floor
 *
 *  One sensor over the peak would shout "FULL" while the bin is
 *  half empty. One sensor over the hollow would say "nearly
 *  empty" while rubbish is spilling over the far side. Reading
 *  both diagonals and averaging them is much closer to the truth.
 *
 *  fillX       = (BIN_HEIGHT - distX) / BIN_HEIGHT * 100
 *  fillPercent = (fillA + fillB) / 2
 *  uneven      = |fillA - fillB| > LEVEL_DISAGREE_PCT
 **************************************************************/
#ifndef BIN_LEVEL_H
#define BIN_LEVEL_H

#include <Arduino.h>

typedef enum {
  BIN_OK,        //   0 - 74 %  green
  BIN_WARNING,   //  75 - 89 %  amber, schedule a pickup
  BIN_FULL,      //  90 - 100 % red + buzzer, collect now
  BIN_ERROR      //  neither level sensor gave a usable reading
} BinStatus;

/* Everything the level subsystem knows after one measurement. */
typedef struct {
  float   fillA;        // percentage seen by sensor A, or INVALID
  float   fillB;        // percentage seen by sensor B, or INVALID
  float   fillPercent;  // the fused value the rest of the system uses
  float   spread;       // |fillA - fillB|, 0 when only one is valid
  bool    uneven;       // true when the load is piled to one side
  uint8_t validCount;   // 2 = healthy, 1 = degraded, 0 = failed
} LevelReading;

float        binLevelCalculatePercent(float measuredDistanceCm);
LevelReading binLevelFuse(float distanceA, float distanceB);
BinStatus    binLevelClassify(const LevelReading *r);
const char*  binLevelStatusName(BinStatus s);

#endif /* BIN_LEVEL_H */

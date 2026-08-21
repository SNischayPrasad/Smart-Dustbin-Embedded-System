#include "bin_level.h"
#include "config.h"

/* --------------------------------------------------------------
 *  binLevelCalculatePercent()
 *  Pure maths for ONE sensor - no hardware touched, so it is easy
 *  to test: feed it 30 -> expect 0, feed it 15 -> expect 50.
 * ------------------------------------------------------------ */
float binLevelCalculatePercent(float measuredDistanceCm) {

  /* Any negative value is the "no echo" sentinel. A real distance can
     never be negative, so this is missing data, not a very full bin. */
  if (measuredDistanceCm < 0) {
    return INVALID_READING;
  }

  /* A reading longer than the bin still just means "empty". */
  if (measuredDistanceCm > BIN_HEIGHT_CM) measuredDistanceCm = BIN_HEIGHT_CM;

  float fillLevel   = BIN_HEIGHT_CM - measuredDistanceCm;
  float fillPercent = (fillLevel / BIN_HEIGHT_CM) * 100.0f;

  if (fillPercent < 0.0f)   fillPercent = 0.0f;
  if (fillPercent > 100.0f) fillPercent = 100.0f;

  return fillPercent;
}

/* --------------------------------------------------------------
 *  binLevelFuse()
 *  Combines the two in-bin sensors into a single answer.
 *
 *  Both valid  -> average them, and flag a big disagreement.
 *  One valid   -> use it and carry on. The bin is degraded, not
 *                 dead: half a measurement beats no measurement.
 *  None valid  -> report failure so the caller can raise
 *                 BIN_ERROR instead of inventing a number.
 * ------------------------------------------------------------ */
LevelReading binLevelFuse(float distanceA, float distanceB) {
  LevelReading r;

  r.fillA      = binLevelCalculatePercent(distanceA);
  r.fillB      = binLevelCalculatePercent(distanceB);
  r.spread     = 0.0f;
  r.uneven     = false;
  r.validCount = 0;

  bool aOk = (r.fillA != INVALID_READING);
  bool bOk = (r.fillB != INVALID_READING);

  if (aOk && bOk) {
    r.validCount  = 2;
    r.fillPercent = (r.fillA + r.fillB) * 0.5f;
    r.spread      = fabs(r.fillA - r.fillB);
    r.uneven      = (r.spread > LEVEL_DISAGREE_PCT);

  } else if (aOk) {
    r.validCount  = 1;
    r.fillPercent = r.fillA;

  } else if (bOk) {
    r.validCount  = 1;
    r.fillPercent = r.fillB;

  } else {
    r.validCount  = 0;
    r.fillPercent = INVALID_READING;
  }

  return r;
}

/* --------------------------------------------------------------
 *  binLevelClassify()
 *  Turns the fused number into a decision. Keeping the thresholds
 *  in config.h means a city can retune its whole fleet without
 *  touching this logic.
 * ------------------------------------------------------------ */
BinStatus binLevelClassify(const LevelReading *r) {
  if (r->validCount == 0)                       return BIN_ERROR;
  if (r->fillPercent >= LEVEL_FULL_PERCENT)     return BIN_FULL;
  if (r->fillPercent >= LEVEL_WARN_PERCENT)     return BIN_WARNING;
  return BIN_OK;
}

const char* binLevelStatusName(BinStatus s) {
  switch (s) {
    case BIN_OK:      return "OK";
    case BIN_WARNING: return "WARNING";
    case BIN_FULL:    return "FULL";
    case BIN_ERROR:   return "SENSOR_ERROR";
  }
  return "UNKNOWN";
}

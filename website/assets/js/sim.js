/* ==========================================================================
   sim.js - the "firmware twin"
   --------------------------------------------------------------------------
   This is a line-for-line JavaScript port of the state machine inside
   arduino_code/04_smart_dustbin_complete.ino. Same thresholds, same timings,
   same transitions, same three sensors: one on the front for the hand, and
   two INSIDE the bin whose readings are fused into a single fill level.

   WHY IT EXISTS
   The Wokwi embed below it runs the REAL compiled AVR firmware, which is the
   authoritative simulation. This twin runs in the page itself, so the
   dashboard still demonstrates the logic when there is no internet, and it
   lets you drag a slider and watch the lid react instantly.

   If you change a threshold in the .ino file, change it here too - the whole
   point is that the two agree.
   ========================================================================== */

function FirmwareTwin(options) {
  const cfg = Object.assign({
    BIN_HEIGHT_CM:      30,
    HAND_DETECT_CM:     25,
    WARN_PERCENT:       75,
    FULL_PERCENT:       90,
    DISAGREE_PCT:       25,
    LID_OPEN_HOLD_MS:   3000,
    LID_TRAVEL_MS:      400,
    LEVEL_SAMPLE_MS:    1000,
    BEEP_ON_MS:         200,
    BEEP_OFF_MS:        1800
  }, options || {});

  const self = this;

  /* ---- Inputs (what the three sensors are reporting) ----------------- */
  this.handDistance   = 80;     /* cm - nothing in front of the bin       */
  this.wasteDistanceA = 30;     /* cm - in-bin sensor A, empty            */
  this.wasteDistanceB = 30;     /* cm - in-bin sensor B, empty            */

  /* Convenience: reading or writing `wasteDistance` treats the rubbish as
     perfectly flat, which is what most tests and simple demos want.      */
  Object.defineProperty(this, "wasteDistance", {
    get: function () { return (self.wasteDistanceA + self.wasteDistanceB) / 2; },
    set: function (v) { self.wasteDistanceA = v; self.wasteDistanceB = v; }
  });

  /* ---- Outputs / internal state -------------------------------------- */
  this.lidState      = "CLOSED";
  this.binStatus     = "OK";
  this.fillA         = 0;       /* percentage seen by sensor A           */
  this.fillB         = 0;       /* percentage seen by sensor B           */
  this.fillPercent   = 0;       /* the fused value                       */
  this.fillSpread    = 0;       /* |fillA - fillB|                       */
  this.unevenLoad    = false;   /* rubbish piled to one side             */
  this.validSensors  = 2;       /* 2 healthy, 1 degraded, 0 failed       */
  this.openCount     = 0;
  this.errorCount    = 0;
  this.buzzerEnabled = true;
  this.buzzerOn      = false;
  this.ledGreen      = false;
  this.ledRed        = false;
  this.manualOverride= false;

  let stateEnteredAt = 0;
  let lastSeenHandAt = -99999;
  let lastLevelAt    = -99999;
  let buzzerChanged  = 0;
  let blinkChanged   = 0;
  let blinkOn        = false;

  this.onSerial = cfg.onSerial || function () {};

  /* ---- calculateFillPercent() - identical maths to the firmware ------ */
  this.calculateFillPercent = function (distanceCm) {
    if (distanceCm < 0) return -1;          /* sentinel: no echo */
    let d = distanceCm;
    if (d > cfg.BIN_HEIGHT_CM) d = cfg.BIN_HEIGHT_CM;
    let pct = ((cfg.BIN_HEIGHT_CM - d) / cfg.BIN_HEIGHT_CM) * 100;
    return Math.min(100, Math.max(0, pct));
  };

  /* ---- fuseLevelSensors() - identical policy to the firmware ---------
     Both valid -> average, and flag a large gap as an uneven load.
     One valid  -> keep working in a clearly degraded mode.
     Neither    -> report failure rather than inventing a number.       */
  this.fuseLevelSensors = function (dA, dB) {
    const a = self.calculateFillPercent(dA);
    const b = self.calculateFillPercent(dB);

    const aOk = (a >= 0);
    const bOk = (b >= 0);

    self.fillA      = aOk ? a : -1;
    self.fillB      = bOk ? b : -1;
    self.fillSpread = 0;
    self.unevenLoad = false;

    if (aOk && bOk) {
      self.validSensors = 2;
      self.fillPercent  = (a + b) / 2;
      self.fillSpread   = Math.abs(a - b);
      self.unevenLoad   = self.fillSpread > cfg.DISAGREE_PCT;
    } else if (aOk) {
      self.validSensors = 1; self.fillPercent = a;
    } else if (bOk) {
      self.validSensors = 1; self.fillPercent = b;
    } else {
      self.validSensors = 0;   /* keep the last known fillPercent */
    }
  };

  function enterState(s, now) {
    if (self.lidState !== s) {
      self.lidState  = s;
      stateEnteredAt = now;
      return true;
    }
    return false;
  }

  /* ---- updateLidStateMachine() --------------------------------------- */
  function updateLid(handDetected, now) {
    if (handDetected) lastSeenHandAt = now;

    switch (self.lidState) {

      case "CLOSED":
        if (handDetected) {
          self.openCount++;
          enterState("OPENING", now);
          self.onSerial(">>> Hand detected - opening lid", "in");
        }
        break;

      case "OPENING":
        if (now - stateEnteredAt >= cfg.LID_TRAVEL_MS) enterState("OPEN", now);
        break;

      case "OPEN":
        if (now - lastSeenHandAt >= cfg.LID_OPEN_HOLD_MS) {
          enterState("CLOSING", now);
          self.onSerial("<<< Area clear - closing lid", "dim");
        }
        break;

      case "CLOSING":
        if (handDetected) {                       /* safety re-open */
          enterState("OPENING", now);
          self.onSerial("!!! Hand returned - re-opening", "warn");
        } else if (now - stateEnteredAt >= cfg.LID_TRAVEL_MS) {
          enterState("CLOSED", now);
        }
        break;
    }
  }

  this.lidIsOpen = function () {
    return self.lidState === "OPEN" || self.lidState === "OPENING";
  };

  /* ---- taskBinLevel() ------------------------------------------------
     The real firmware measures the level once per second, not on every
     pass of loop(). The twin does the same so that counters such as
     `errors` advance at the same rate on both.                          */
  function updateLevel(now) {
    if (now - lastLevelAt < cfg.LEVEL_SAMPLE_MS) return;

    /* The firmware skips the measurement while the lid is up, because the
       sensor would be looking at the sky instead of the rubbish. Note that
       a skipped measurement does NOT consume the slot - we retry on the
       next pass, exactly as the device does.                            */
    if (self.lidIsOpen()) return;

    lastLevelAt = now;

    self.fuseLevelSensors(self.wasteDistanceA, self.wasteDistanceB);

    if (self.validSensors === 0) {
      self.errorCount++;
      self.binStatus = "SENSOR_ERROR";
      return;
    }

    if      (self.fillPercent >= cfg.FULL_PERCENT) self.binStatus = "FULL";
    else if (self.fillPercent >= cfg.WARN_PERCENT) self.binStatus = "WARNING";
    else                                          self.binStatus = "OK";
  }

  /* ---- taskAlerts() -------------------------------------------------- */
  function blinkPhase(now, period) {
    if (now - blinkChanged >= period) { blinkOn = !blinkOn; blinkChanged = now; }
    return blinkOn;
  }

  function updateAlerts(now) {
    switch (self.binStatus) {
      case "OK":
        self.ledGreen = true;  self.ledRed = false;
        self.buzzerOn = false;
        break;
      case "WARNING":
        self.ledGreen = true;  self.ledRed = blinkPhase(now, 500);
        self.buzzerOn = false;
        break;
      case "FULL":
        self.ledGreen = false; self.ledRed = true;
        if (!self.buzzerEnabled) {
          self.buzzerOn = false;
        } else if (self.buzzerOn && now - buzzerChanged >= cfg.BEEP_ON_MS) {
          self.buzzerOn = false; buzzerChanged = now;
        } else if (!self.buzzerOn && now - buzzerChanged >= cfg.BEEP_OFF_MS) {
          self.buzzerOn = true;  buzzerChanged = now;
        }
        break;
      case "SENSOR_ERROR":
        self.ledGreen = false; self.ledRed = blinkPhase(now, 150);
        self.buzzerOn = false;
        break;
    }
  }

  /* ---- loop() -------------------------------------------------------- */
  this.step = function (now) {
    const handDetected = self.handDistance >= 2 &&
                         self.handDistance <= cfg.HAND_DETECT_CM;

    if (!self.manualOverride) updateLid(handDetected, now);

    updateLevel(now);
    updateAlerts(now);
    return self;
  };

  /* ---- The serial command set, exactly as on the device -------------- */
  this.command = function (cmd) {
    switch (String(cmd).toUpperCase()) {
      case "OPEN":
        self.manualOverride = true; self.lidState = "OPEN";   return "ACK: lid forced OPEN";
      case "CLOSE":
        self.manualOverride = true; self.lidState = "CLOSED"; return "ACK: lid forced CLOSED";
      case "AUTO":
        self.manualOverride = false; return "ACK: back to automatic mode";
      case "MUTE":
        self.buzzerEnabled = false; self.buzzerOn = false; return "ACK: buzzer muted";
      case "UNMUTE":
        self.buzzerEnabled = true;  return "ACK: buzzer enabled";
      case "EMPTY":
        self.wasteDistance = cfg.BIN_HEIGHT_CM;
        self.fillPercent = 0; self.fillA = 0; self.fillB = 0;
        self.fillSpread = 0; self.unevenLoad = false;
        self.binStatus = "OK"; self.openCount = 0;
        return "ACK: bin marked as collected, counters reset";
      case "STATUS":
        return self.telemetryLine();
      case "HELP":
        return "Commands: OPEN CLOSE AUTO MUTE UNMUTE EMPTY STATUS HELP";
      default:
        return "ERR: unknown command - type HELP";
    }
  };

  /* ---- The exact telemetry format the firmware prints ---------------- */
  this.telemetryLine = function () {
    const blocks = Math.round(self.fillPercent / 5);
    const bar = "[" + "#".repeat(blocks) + "-".repeat(20 - blocks) + "]";
    const pct = v => (v < 0 ? "--" : Math.round(v));
    return "Hand=" + self.handDistance.toFixed(1) + "cm" +
           " | Lid=" + self.lidState +
           " | A=" + pct(self.fillA) + "% B=" + pct(self.fillB) + "%" +
           " | Fill=" + Math.round(self.fillPercent) + "%" +
           " | Status=" + self.binStatus +
           " | Opens=" + self.openCount +
           (self.unevenLoad ? " | UNEVEN LOAD" : "") +
           (self.validSensors === 1 ? " | DEGRADED 1 SENSOR" : "") +
           "\n        " + bar;
  };

  this.jsonLine = function () {
    return JSON.stringify({
      id:      cfg.deviceId || "BIN-001",
      fill:    Math.round(self.fillPercent),
      fillA:   self.fillA < 0 ? -1 : Math.round(self.fillA),
      fillB:   self.fillB < 0 ? -1 : Math.round(self.fillB),
      spread:  Math.round(self.fillSpread),
      uneven:  self.unevenLoad,
      sensors: self.validSensors,
      lid:     self.lidState,
      status:  self.binStatus,
      opens:   self.openCount,
      errors:  self.errorCount
    });
  };

  /* Lets the UI request an immediate re-measurement when the operator
     drags a slider, instead of waiting up to a second for the next tick. */
  this.forceLevelSample = function () { lastLevelAt = -99999; };

  this.setConfig = function (key, value) { cfg[key] = value; };
  this.getConfig = function () { return cfg; };
}

/* ==========================================================================
   DustbinView - draws the twin as an SVG and keeps it in sync
   ========================================================================== */
function DustbinView(container) {
  container.innerHTML = [
    '<svg viewBox="0 0 170 210" role="img" aria-label="Animated dustbin">',
      '<defs>',
        '<linearGradient id="binBody" x1="0" y1="0" x2="1" y2="1">',
          '<stop offset="0%" stop-color="#e8e8ed"/><stop offset="100%" stop-color="#d2d2d7"/>',
        '</linearGradient>',
        '<linearGradient id="wasteGrad" x1="0" y1="0" x2="0" y2="1">',
          '<stop offset="0%" stop-color="#34c759"/><stop offset="100%" stop-color="#248a3d"/>',
        '</linearGradient>',
        '<clipPath id="binClip">',
          '<path d="M53 64 L59 195 Q59 198 62 198 L128 198 Q131 198 131 195 L137 64 Z"/>',
        '</clipPath>',
      '</defs>',
      '<g>',
        '<rect x="6" y="86" width="20" height="13" rx="3" fill="#f5f5f7" stroke="#0071e3" stroke-width="1"/>',
        '<circle cx="12" cy="92.5" r="3.2" fill="#ffffff" stroke="#0071e3" stroke-width=".8"/>',
        '<circle cx="20" cy="92.5" r="3.2" fill="#ffffff" stroke="#0071e3" stroke-width=".8"/>',
        '<text x="16" y="110" text-anchor="middle" font-size="7" fill="#86868b">HAND</text>',
      '</g>',
      '<g id="sonarWave" opacity="0.15">',
        '<path d="M30 86 Q38 92.5 30 99" fill="none" stroke="#0071e3" stroke-width="1.4"/>',
        '<path d="M36 82 Q47 92.5 36 103" fill="none" stroke="#0071e3" stroke-width="1.2" opacity=".7"/>',
        '<path d="M42 78 Q56 92.5 42 107" fill="none" stroke="#0071e3" stroke-width="1" opacity=".45"/>',
      '</g>',
      '<path d="M52 62 L58 196 Q58 200 62 200 L128 200 Q132 200 132 196 L138 62 Z" fill="url(#binBody)" stroke="#b8b8bf" stroke-width="1.6"/>',
      '<polygon id="wasteFill" points="48,198 142,198 142,200 48,200" fill="url(#wasteGrad)" clip-path="url(#binClip)"/>',
      '<line x1="55" y1="77" x2="136" y2="77" stroke="#86868b" stroke-width=".6" stroke-dasharray="3 3"/>',
      '<text x="143" y="79" font-size="7" fill="#86868b">90%</text>',
      '<line x1="56" y1="97" x2="135" y2="97" stroke="#86868b" stroke-width=".6" stroke-dasharray="3 3"/>',
      '<text x="143" y="99" font-size="7" fill="#86868b">75%</text>',
      '<g id="lidGroup" class="lid-group">',
        '<rect x="46" y="46" width="98" height="13" rx="5" fill="#c7c7cc" stroke="#a1a1a6" stroke-width="1.2"/>',
        '<rect x="86" y="38" width="18" height="9" rx="3" fill="#c7c7cc" stroke="#a1a1a6" stroke-width="1"/>',
        '<rect x="54" y="59" width="18" height="9" rx="2" fill="#f5f5f7" stroke="#0071e3" stroke-width=".9"/>',
        '<circle cx="59" cy="63.5" r="2.2" fill="#ffffff" stroke="#0071e3" stroke-width=".6"/>',
        '<circle cx="67" cy="63.5" r="2.2" fill="#ffffff" stroke="#0071e3" stroke-width=".6"/>',
        '<text x="63" y="76" text-anchor="middle" font-size="6.5" font-weight="700" fill="#0071e3">A</text>',
        '<rect x="112" y="59" width="18" height="9" rx="2" fill="#f5f5f7" stroke="#0071e3" stroke-width=".9"/>',
        '<circle cx="117" cy="63.5" r="2.2" fill="#ffffff" stroke="#0071e3" stroke-width=".6"/>',
        '<circle cx="125" cy="63.5" r="2.2" fill="#ffffff" stroke="#0071e3" stroke-width=".6"/>',
        '<text x="121" y="76" text-anchor="middle" font-size="6.5" font-weight="700" fill="#0071e3">B</text>',
      '</g>',
      '<rect x="68" y="150" width="56" height="26" rx="6" fill="#f5f5f7" stroke="#c7c7cc" stroke-width="1"/>',
      '<circle id="ledGreen" class="led-lamp led-off" cx="80" cy="163" r="5"/>',
      '<circle id="ledRed" class="led-lamp led-off" cx="96" cy="163" r="5"/>',
      '<g id="buzzerIcon" opacity="0.25">',
        '<path d="M108 159 h4 l5 -4 v14 l-5 -4 h-4 z" fill="#ff9500"/>',
        '<path d="M119 160 q3 3.5 0 7" fill="none" stroke="#ff9500" stroke-width="1.4"/>',
      '</g>',
      '<text x="95" y="192" text-anchor="middle" font-size="8" fill="#86868b" id="binLabel">BIN-001</text>',
      '<text x="95" y="30" text-anchor="middle" font-size="8" font-weight="700" fill="#ff9500" id="unevenTag" opacity="0">UNEVEN LOAD</text>',
    '</svg>'
  ].join("");

  const el = {
    lid:    container.querySelector("#lidGroup"),
    waste:  container.querySelector("#wasteFill"),
    green:  container.querySelector("#ledGreen"),
    red:    container.querySelector("#ledRed"),
    buzzer: container.querySelector("#buzzerIcon"),
    sonar:  container.querySelector("#sonarWave"),
    label:  container.querySelector("#binLabel"),
    uneven: container.querySelector("#unevenTag")
  };

  const TOP = 64, BOTTOM = 198;   /* inner top and bottom of the bin, SVG units */

  this.setLabel = function (text) { el.label.textContent = text; };

  this.render = function (twin) {
    /* lid rotation */
    const open = (twin.lidState === "OPEN" || twin.lidState === "OPENING");
    el.lid.style.transformOrigin = "50px 52px";
    el.lid.style.transform = open ? "rotate(-58deg)" : "rotate(0deg)";

    /* Waste level. Sensor A sits over the left half and sensor B over the
       right half, so the surface is drawn as a slope between the two
       readings. A flat load gives a flat line; an uneven one visibly tilts. */
    const span  = BOTTOM - TOP;
    const pctA  = twin.fillA >= 0 ? twin.fillA : twin.fillPercent;
    const pctB  = twin.fillB >= 0 ? twin.fillB : twin.fillPercent;
    const yA    = BOTTOM - (span * pctA) / 100;
    const yB    = BOTTOM - (span * pctB) / 100;
    el.waste.setAttribute("points",
      "48," + yA.toFixed(1) + " 142," + yB.toFixed(1) + " 142,200 48,200");
    el.waste.setAttribute("fill",
      twin.binStatus === "FULL"    ? "#ff3b30" :
      twin.binStatus === "WARNING" ? "#ff9500" : "url(#wasteGrad)");

    el.uneven.setAttribute("opacity", twin.unevenLoad ? "1" : "0");

    /* indicator LEDs */
    el.green.setAttribute("class", "led-lamp " + (twin.ledGreen ? "led-on-green" : "led-off"));
    el.red.setAttribute("class",   "led-lamp " + (twin.ledRed   ? "led-on-red"   : "led-off"));

    /* buzzer icon and the sonar cone */
    el.buzzer.setAttribute("opacity", twin.buzzerOn ? "1" : "0.25");
    el.sonar.setAttribute("opacity",
      twin.handDistance <= twin.getConfig().HAND_DETECT_CM ? "1" : "0.15");
  };
}

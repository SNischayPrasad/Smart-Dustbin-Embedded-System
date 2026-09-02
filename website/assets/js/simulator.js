/* ==========================================================================
   simulator.js - wires the firmware twin to a page
   --------------------------------------------------------------------------
   sim.js provides the logic (FirmwareTwin) and the drawing (DustbinView).
   This file connects them to sliders, buttons, readouts and a serial console.

   It is shared by the public page and the admin dashboard, so the two can
   never drift apart. Everything is scoped to a root element, and each
   control is optional: a page that omits the serial console still works.
   ========================================================================== */

function initSimulator(rootSelector, options) {
  options = options || {};

  const root = document.querySelector(rootSelector);
  if (!root) return null;

  const $  = sel => root.querySelector(sel);
  const $$ = sel => Array.from(root.querySelectorAll(sel));

  const consoleEl = $("[data-sim=console]");
  const deviceId  = options.deviceId || "BIN-SIM";

  /* ---- serial console ------------------------------------------------- */
  function serialPrint(text, cls) {
    if (!consoleEl) return;
    const atBottom = consoleEl.scrollTop + consoleEl.clientHeight >= consoleEl.scrollHeight - 20;
    const line = document.createElement("div");
    if (cls) line.className = "c-" + cls;
    line.textContent = text;
    consoleEl.appendChild(line);
    while (consoleEl.childNodes.length > 220) consoleEl.removeChild(consoleEl.firstChild);
    if (atBottom) consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  /* ---- the twin and its picture --------------------------------------- */
  const twin = new FirmwareTwin({
    deviceId: deviceId,
    onSerial: (line, cls) => serialPrint(line, cls)
  });

  const viewHost = $("[data-sim=view]");
  const view = viewHost ? new DustbinView(viewHost) : null;
  if (view) view.setLabel(deviceId);

  const handSlider   = $("[data-sim=handSlider]");
  const wasteSliderA = $("[data-sim=wasteSliderA]");
  const wasteSliderB = $("[data-sim=wasteSliderB]");

  /* A slider parked at "unplugged" stands in for a dead sensor: -1 is the
     same no-echo sentinel the firmware uses. */
  const UNPLUGGED = { A: false, B: false };

  const BIN_HEIGHT = (typeof SD !== "undefined" && SD.CONFIG)
                     ? SD.CONFIG.BIN_HEIGHT_CM : 30;

  function setText(sel, value) { const el = $(sel); if (el) el.textContent = value; }

  function syncSliders() {
    twin.handDistance   = parseFloat(handSlider.value);
    twin.wasteDistanceA = UNPLUGGED.A ? -1 : parseFloat(wasteSliderA.value);
    twin.wasteDistanceB = UNPLUGGED.B ? -1 : parseFloat(wasteSliderB.value);
    twin.forceLevelSample();

    setText("[data-sim=handVal]", twin.handDistance.toFixed(1) + " cm");

    setText("[data-sim=wasteValA]", UNPLUGGED.A ? "no echo"
      : parseFloat(wasteSliderA.value).toFixed(1) + " cm");
    setText("[data-sim=wasteValB]", UNPLUGGED.B ? "no echo"
      : parseFloat(wasteSliderB.value).toFixed(1) + " cm");

    setText("[data-sim=fillValA]", UNPLUGGED.A ? "--"
      : Math.round(twin.calculateFillPercent(parseFloat(wasteSliderA.value))) + "%");
    setText("[data-sim=fillValB]", UNPLUGGED.B ? "--"
      : Math.round(twin.calculateFillPercent(parseFloat(wasteSliderB.value))) + "%");
  }

  handSlider.addEventListener("input", syncSliders);
  [wasteSliderA, wasteSliderB].forEach(function (sl) {
    sl.addEventListener("input", function () {
      if (sl === wasteSliderA) UNPLUGGED.A = false;
      if (sl === wasteSliderB) UNPLUGGED.B = false;
      syncSliders();
    });
  });

  $$("[data-hand]").forEach(function (b) {
    b.addEventListener("click", function () {
      handSlider.value = b.getAttribute("data-hand");
      syncSliders();
    });
  });

  /* The percentage buttons run the firmware formula backwards, so 75%
     really is a 7.5 cm gap in a 30 cm bin. They set BOTH in-bin sensors,
     which is a perfectly flat load. */
  const distanceForFill = pct => BIN_HEIGHT * (1 - pct / 100);

  $$("[data-fill]").forEach(function (b) {
    b.addEventListener("click", function () {
      const pct = parseFloat(b.getAttribute("data-fill"));
      UNPLUGGED.A = UNPLUGGED.B = false;
      wasteSliderA.value = distanceForFill(pct);
      wasteSliderB.value = distanceForFill(pct);
      syncSliders();
      serialPrint("-- operator set a flat load of " + pct + "% --", "dim");
    });
  });

  /* The scenario buttons are the point of the whole design. */
  $$("[data-scenario]").forEach(function (b) {
    b.addEventListener("click", function () {
      const what = b.getAttribute("data-scenario");

      if (what === "uneven") {
        UNPLUGGED.A = UNPLUGGED.B = false;
        wasteSliderA.value = distanceForFill(90);
        wasteSliderB.value = distanceForFill(10);
        serialPrint("-- rubbish piled to one side: A sees 90%, B sees 10% --", "warn");
        serialPrint("-- a single-sensor bin over A would have reported FULL --", "dim");

      } else if (what === "failA") {
        UNPLUGGED.A = true;
        serialPrint("-- sensor A cable pulled: running on B alone --", "warn");

      } else {
        UNPLUGGED.A = UNPLUGGED.B = false;
        wasteSliderA.value = BIN_HEIGHT;
        wasteSliderB.value = BIN_HEIGHT;
        serialPrint("-- sensors reset, bin empty --", "dim");
      }
      syncSliders();
    });
  });

  const clearBtn = $("[data-sim=clear]");
  if (clearBtn && consoleEl) {
    clearBtn.addEventListener("click", function () { consoleEl.innerHTML = ""; });
  }

  /* ---- command input --------------------------------------------------- */
  const cmdInput = $("[data-sim=cmdInput]");
  const cmdSend  = $("[data-sim=cmdSend]");

  function sendCommand() {
    if (!cmdInput) return;
    const cmd = cmdInput.value.trim();
    if (!cmd) return;
    serialPrint("> " + cmd, "in");
    serialPrint(twin.command(cmd));
    if (cmd.toUpperCase() === "EMPTY") {
      UNPLUGGED.A = UNPLUGGED.B = false;
      wasteSliderA.value = BIN_HEIGHT;
      wasteSliderB.value = BIN_HEIGHT;
      syncSliders();
    }
    cmdInput.value = "";
  }
  if (cmdSend)  cmdSend.addEventListener("click", sendCommand);
  if (cmdInput) cmdInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") sendCommand();
  });

  /* ---- boot banner, exactly as the real sketch prints ------------------ */
  if (consoleEl) {
    [
      "==================================================",
      "   SMART DUSTBIN - EMBEDDED SYSTEM (ESP32)",
      "   Device  : " + deviceId,
      "   Firmware: v2.0.0-wifi",
      "   Sensors : 1 hand + 2 in-bin level (A and B)",
      "   Bin height     : " + BIN_HEIGHT.toFixed(1) + " cm",
      "   Hand threshold : 25.0 cm",
      "   Warn / Full    : 75 % / 90 %",
      "   Uneven-load gap: 25 %",
      "==================================================",
      "Power-on self test ... outputs OK",
      "Sensor check: HAND OK | LEVEL-A OK | LEVEL-B OK"
    ].forEach(function (l) { serialPrint(l); });
    serialPrint("System running. Type HELP for commands.", "dim");
  }

  /* ---- the simulated loop(): 20 fps, telemetry every 2 s --------------- */
  let lastTelemetry = 0;
  const started = Date.now();

  syncSliders();

  const timer = setInterval(function () {
    const now = Date.now() - started;
    twin.step(now);
    if (view) view.render(twin);

    setText("[data-sim=lid]",     twin.lidState);
    setText("[data-sim=status]",  twin.binStatus);
    setText("[data-sim=fill]",    Math.round(twin.fillPercent) + "%");
    setText("[data-sim=spread]",  Math.round(twin.fillSpread) + "%" + (twin.unevenLoad ? " !" : ""));
    setText("[data-sim=sensors]", twin.validSensors + " / 2");
    setText("[data-sim=green]",   twin.ledGreen ? "ON" : "OFF");
    setText("[data-sim=red]",     twin.ledRed   ? "ON" : "OFF");
    setText("[data-sim=buzzer]",  !twin.buzzerEnabled ? "MUTED" : (twin.buzzerOn ? "BEEP" : "SILENT"));
    setText("[data-sim=opens]",   twin.openCount);

    if (consoleEl && now - lastTelemetry >= 2000) {
      lastTelemetry = now;
      serialPrint("[" + Math.floor(now / 1000) + "s] " + twin.telemetryLine());
      serialPrint(twin.jsonLine(), "dim");
    }
  }, 50);

  return {
    twin: twin,
    view: view,
    stop: function () { clearInterval(timer); }
  };
}

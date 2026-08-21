/* ==========================================================================
   admin.js - Smart Dustbin admin console
   --------------------------------------------------------------------------
   Sections
     1. session + chrome
     2. map and fleet rendering
     3. selection + remote control
     4. bulk fleet actions
     5. the firmware twin simulator
     6. Wokwi embed
     7. live ESP32 device polling
   ========================================================================== */
(function () {

  /* =====================================================================
     1. SESSION AND CHROME
     =================================================================== */
  const session = AUTH.currentSession();
  if (!session) return;                       /* the guard already redirected */

  document.getElementById("whoami").textContent  = session.name + " (" + session.role + ")";
  document.getElementById("footUser").textContent = session.username;

  document.getElementById("logoutBtn").addEventListener("click", function () {
    AUTH.logout();
    window.location.href = "login.html";
  });

  const toastEl = document.getElementById("toast");
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  /* =====================================================================
     2. MAP AND FLEET RENDERING
     =================================================================== */
  let selectedId = null;

  const map = new BinMap("map", {
    interactive: true,
    onSelect: function (binId) { selectBin(binId); }
  });

  /* zone filter options */
  const zoneSel = document.getElementById("zoneFilter");
  SD.getZones().forEach(function (z) {
    const o = document.createElement("option");
    o.value = z; o.textContent = z;
    zoneSel.appendChild(o);
  });

  function visibleBins() {
    const zone   = zoneSel.value;
    const status = document.getElementById("statusFilter").value;
    const q      = document.getElementById("search").value.trim().toLowerCase();

    return SD.getFleet().filter(function (b) {
      if (zone && b.zone !== zone) return false;
      if (status && SD.statusOf(b) !== status) return false;
      if (q) {
        const hay = (b.id + " " + b.name + " " + b.zone + " " + b.category).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderKpis() {
    const s = SD.summary();
    document.getElementById("kTotal").textContent   = s.total;
    document.getElementById("kOk").textContent      = s.ok;
    document.getElementById("kWarn").textContent    = s.warning;
    document.getElementById("kFull").textContent    = s.full;
    document.getElementById("kOffline").textContent = s.offline;
    document.getElementById("kAvg").textContent     = s.avgFill + "%";
    document.getElementById("kZones").textContent   = SD.getZones().length + " zones";
  }

  function renderTable() {
    const list = visibleBins();

    if (!list.length) {
      document.getElementById("binRows").innerHTML =
        '<tr><td colspan="10" class="muted" style="text-align:center;padding:1.5rem">' +
        'No bins match the current filters.</td></tr>';
      return;
    }

    document.getElementById("binRows").innerHTML = list.map(function (b) {
      const st   = SD.statusOf(b);
      const fill = Math.round(b.fill);
      const sel  = b.id === selectedId ? " selected" : "";
      return '' +
      '<tr data-bin="' + b.id + '" class="' + sel.trim() + '">' +
        '<td><b>' + escapeHtml(b.id) + '</b></td>' +
        '<td>' + escapeHtml(b.name) + '</td>' +
        '<td>' + escapeHtml(b.zone) + '</td>' +
        '<td>' + escapeHtml(b.category) + '</td>' +
        '<td><div class="fill-bar"><span class="fill-' + st + '" style="width:' +
            (b.online ? fill : 0) + '%"></span></div>' +
            '<span class="muted">' + (b.online ? fill + "%" : "n/a") + '</span></td>' +
        '<td>' + b.lid + (b.manual ? ' <span class="muted">(manual)</span>' : '') + '</td>' +
        '<td class="num">' + Math.round(b.battery) + '%</td>' +
        '<td><span class="badge badge-' + st + '"><span class="dot"></span>' +
            SD.statusLabel(st) + '</span></td>' +
        '<td class="muted">' + timeAgo(b.lastSeen) + '</td>' +
        '<td><button class="btn btn-sm" data-row-cmd="EMPTY" data-bin="' + b.id +
            '">Collect</button></td>' +
      '</tr>';
    }).join("");

    document.querySelectorAll("#binRows tr[data-bin]").forEach(function (tr) {
      tr.addEventListener("click", function (e) {
        if (e.target.hasAttribute("data-row-cmd")) return;   /* button handled below */
        selectBin(tr.getAttribute("data-bin"));
        map.flyTo(tr.getAttribute("data-bin"));
      });
    });

    document.querySelectorAll("[data-row-cmd]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        const r = SD.sendCommand(btn.getAttribute("data-bin"), btn.getAttribute("data-row-cmd"));
        toast(btn.getAttribute("data-bin") + ": " + r.message);
        refresh();
      });
    });
  }

  /* =====================================================================
     3. SELECTION AND REMOTE CONTROL
     =================================================================== */
  function selectBin(binId) {
    selectedId = binId;
    map.select(binId);
    renderSelected();
    renderTable();
  }

  function renderSelected() {
    const bin = SD.getBin(selectedId);
    const body  = document.getElementById("selBody");
    const empty = document.getElementById("selEmpty");

    if (!bin) {
      body.classList.add("hidden");
      empty.classList.remove("hidden");
      document.getElementById("selName").textContent = "No bin selected";
      return;
    }

    empty.classList.add("hidden");
    body.classList.remove("hidden");

    const st   = SD.statusOf(bin);
    const fill = Math.round(bin.fill);

    document.getElementById("selName").textContent = bin.id + " - " + bin.name;
    document.getElementById("selMeta").textContent =
      bin.zone + " - " + bin.category + " - " + bin.capacity + " L";

    const badge = document.getElementById("selBadge");
    badge.className = "badge badge-" + st;
    badge.innerHTML = '<span class="dot"></span>' + SD.statusLabel(st);

    const bar = document.getElementById("selFillBar");
    bar.className = "fill-" + st;
    bar.style.width = (bin.online ? fill : 0) + "%";
    document.getElementById("selFillText").textContent = bin.online ? fill + "%" : "no data";

    document.getElementById("selLid").textContent   = bin.lid + (bin.manual ? " *" : "");
    document.getElementById("selDist").textContent  = SD.fillToDistance(fill) + " cm";
    document.getElementById("selBatt").textContent  = Math.round(bin.battery) + "%";
    document.getElementById("selRssi").textContent  = bin.rssi + " dBm";
    document.getElementById("selOpens").textContent = bin.opens;
    document.getElementById("selSeen").textContent  = timeAgo(bin.lastSeen);

    /* the mute button reflects the current state */
    const muteBtn = document.querySelector('[data-cmd="MUTE"]');
    if (muteBtn) muteBtn.textContent = bin.muted ? "Buzzer muted" : "Mute buzzer";
  }

  document.querySelectorAll("[data-cmd]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!selectedId) { toast("Select a bin first."); return; }
      const r = SD.sendCommand(selectedId, btn.getAttribute("data-cmd"));
      toast(selectedId + ": " + r.message);
      refresh();
    });
  });

  /* =====================================================================
     4. BULK FLEET ACTIONS
     =================================================================== */
  document.getElementById("bulkMute").addEventListener("click", function () {
    const n = SD.sendBulk("MUTE", b => SD.statusOf(b) === "full");
    toast(n ? "Muted " + n + " full bin(s)." : "No full bins right now.");
    refresh();
  });

  /* A nearest-neighbour route: start at the fullest bin, then repeatedly
     drive to the closest bin still on the list. This is the classic greedy
     solution to the travelling salesman problem - good enough for a van. */
  document.getElementById("bulkRoute").addEventListener("click", function () {
    const due = SD.getFleet()
      .filter(b => b.online && SD.statusOf(b) !== "ok")
      .sort((a, b) => b.fill - a.fill);

    const out = document.getElementById("routeOut");

    if (!due.length) { out.textContent = "Nothing needs collecting. Every bin is under 75%."; return; }

    const route = [due.shift()];
    while (due.length) {
      const last = route[route.length - 1];
      let bestIdx = 0, bestDist = Infinity;
      due.forEach(function (b, i) {
        const d = Math.hypot(b.lat - last.lat, b.lng - last.lng);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      });
      route.push(due.splice(bestIdx, 1)[0]);
    }

    let km = 0;
    for (let i = 1; i < route.length; i++) {
      km += Math.hypot(route[i].lat - route[i-1].lat, route[i].lng - route[i-1].lng) * 111;
    }

    out.innerHTML = '<b>' + route.length + ' stops, about ' + km.toFixed(1) +
      ' km</b><br>' + route.map((b, i) =>
        (i + 1) + ". " + escapeHtml(b.id) + " " + escapeHtml(b.name) +
        " (" + Math.round(b.fill) + "%)").join("<br>");

    SD.addLog("FLEET", "Collection route planned: " + route.length + " stops", "success");
    refresh();
  });

  document.getElementById("resetDemo").addEventListener("click", function () {
    if (!confirm("Reset all demo bins to their starting values?")) return;
    SD.reset();
    selectedId = null;
    document.getElementById("routeOut").textContent = "";
    toast("Demo data reset.");
    refresh();
  });

  document.getElementById("fitBtn").addEventListener("click", () => map.fitAll());

  [zoneSel, document.getElementById("statusFilter")].forEach(el =>
    el.addEventListener("change", renderTable));
  document.getElementById("search").addEventListener("input", renderTable);

  /* =====================================================================
     ACTIVITY FEED
     =================================================================== */
  function renderActivity() {
    const log = SD.getLog();
    document.getElementById("logCount").textContent = log.length + " events";

    if (!log.length) {
      document.getElementById("activityFeed").innerHTML =
        '<div class="muted">Nothing has happened yet.</div>';
      return;
    }

    document.getElementById("activityFeed").innerHTML = log.map(function (e) {
      const colour = { error:"#f87171", warn:"#fbbf24", success:"#4ade80", info:"var(--text-dim)" }[e.level];
      return '<div class="alert-item">' +
               '<time>' + clockTime(e.t) + '</time>' +
               '<div><b>' + escapeHtml(e.binId) + '</b> ' +
               '<span style="color:' + colour + '">' + escapeHtml(e.msg) + '</span></div>' +
             '</div>';
    }).join("");
  }

  /* =====================================================================
     MASTER REFRESH
     =================================================================== */
  function refresh() {
    renderKpis();
    renderTable();
    renderSelected();
    renderActivity();
    map.setBins(SD.getFleet());
  }

  refresh();
  map.fitAll();

  setInterval(function () {
    SD.tick();
    refresh();
  }, 5000);

  /* =====================================================================
     5. THE FIRMWARE TWIN SIMULATOR
     =================================================================== */
  const consoleEl = document.getElementById("serialConsole");

  function serialPrint(text, cls) {
    const atBottom = consoleEl.scrollTop + consoleEl.clientHeight >= consoleEl.scrollHeight - 20;
    const span = document.createElement("div");
    if (cls) span.className = "c-" + cls;
    span.textContent = text;
    consoleEl.appendChild(span);
    while (consoleEl.childNodes.length > 220) consoleEl.removeChild(consoleEl.firstChild);
    if (atBottom) consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  const twin = new FirmwareTwin({
    deviceId: "BIN-SIM",
    onSerial: function (line, cls) { serialPrint(line, cls); }
  });

  const view = new DustbinView(document.getElementById("dustbinView"));
  view.setLabel("BIN-SIM");

  const handSlider   = document.getElementById("handSlider");
  const wasteSliderA = document.getElementById("wasteSliderA");
  const wasteSliderB = document.getElementById("wasteSliderB");

  /* A slider parked at its minimum stands in for an unplugged sensor:
     -1 is the same "no echo" sentinel the firmware uses.               */
  const UNPLUGGED = { A: false, B: false };

  function syncSliders() {
    twin.handDistance   = parseFloat(handSlider.value);
    twin.wasteDistanceA = UNPLUGGED.A ? -1 : parseFloat(wasteSliderA.value);
    twin.wasteDistanceB = UNPLUGGED.B ? -1 : parseFloat(wasteSliderB.value);
    twin.forceLevelSample();   /* react at once instead of waiting for the 1 s tick */

    document.getElementById("handVal").textContent = twin.handDistance.toFixed(1) + " cm";

    document.getElementById("wasteValA").textContent =
      UNPLUGGED.A ? "no echo" : parseFloat(wasteSliderA.value).toFixed(1) + " cm";
    document.getElementById("wasteValB").textContent =
      UNPLUGGED.B ? "no echo" : parseFloat(wasteSliderB.value).toFixed(1) + " cm";

    document.getElementById("fillValA").textContent = UNPLUGGED.A ? "--" :
      Math.round(twin.calculateFillPercent(parseFloat(wasteSliderA.value))) + "%";
    document.getElementById("fillValB").textContent = UNPLUGGED.B ? "--" :
      Math.round(twin.calculateFillPercent(parseFloat(wasteSliderB.value))) + "%";
  }

  handSlider.addEventListener("input", function () {
    syncSliders();
  });
  [wasteSliderA, wasteSliderB].forEach(function (sl) {
    sl.addEventListener("input", function () {
      /* touching a slider implicitly plugs that sensor back in */
      if (sl === wasteSliderA) UNPLUGGED.A = false;
      if (sl === wasteSliderB) UNPLUGGED.B = false;
      syncSliders();
    });
  });

  document.querySelectorAll("[data-hand]").forEach(function (b) {
    b.addEventListener("click", function () {
      handSlider.value = b.getAttribute("data-hand");
      syncSliders();
    });
  });

  /* The percentage buttons work backwards through the same formula the
     firmware uses, so 75% really is a 7.5 cm gap in a 30 cm bin. They set
     BOTH in-bin sensors, which is a perfectly flat load.                 */
  function distanceForFill(pct) {
    return SD.CONFIG.BIN_HEIGHT_CM * (1 - pct / 100);
  }

  document.querySelectorAll("[data-fill]").forEach(function (b) {
    b.addEventListener("click", function () {
      const pct = parseFloat(b.getAttribute("data-fill"));
      UNPLUGGED.A = UNPLUGGED.B = false;
      wasteSliderA.value = distanceForFill(pct);
      wasteSliderB.value = distanceForFill(pct);
      syncSliders();
      serialPrint("-- operator set a flat load of " + pct + "% --", "dim");
    });
  });

  /* Scenario buttons demonstrate exactly why there are two sensors inside. */
  document.querySelectorAll("[data-scenario]").forEach(function (b) {
    b.addEventListener("click", function () {
      const what = b.getAttribute("data-scenario");

      if (what === "uneven") {
        UNPLUGGED.A = UNPLUGGED.B = false;
        wasteSliderA.value = distanceForFill(90);   /* a peak under A  */
        wasteSliderB.value = distanceForFill(10);   /* a hollow under B */
        serialPrint("-- rubbish piled to one side: A sees 90%, B sees 10% --", "warn");
        serialPrint("-- a single-sensor bin over A would have reported FULL --", "dim");

      } else if (what === "failA") {
        UNPLUGGED.A = true;
        serialPrint("-- sensor A cable pulled: running on B alone --", "warn");

      } else {
        UNPLUGGED.A = UNPLUGGED.B = false;
        wasteSliderA.value = SD.CONFIG.BIN_HEIGHT_CM;
        wasteSliderB.value = SD.CONFIG.BIN_HEIGHT_CM;
        serialPrint("-- sensors reset, bin empty --", "dim");
      }
      syncSliders();
    });
  });

  document.getElementById("clearConsole").addEventListener("click", function () {
    consoleEl.innerHTML = "";
  });

  function sendTwinCommand() {
    const input = document.getElementById("cmdInput");
    const cmd = input.value.trim();
    if (!cmd) return;
    serialPrint("> " + cmd, "in");
    serialPrint(twin.command(cmd));
    if (cmd.toUpperCase() === "EMPTY") {
      UNPLUGGED.A = UNPLUGGED.B = false;
      wasteSliderA.value = SD.CONFIG.BIN_HEIGHT_CM;
      wasteSliderB.value = SD.CONFIG.BIN_HEIGHT_CM;
      syncSliders();
    }
    input.value = "";
  }

  document.getElementById("cmdSend").addEventListener("click", sendTwinCommand);
  document.getElementById("cmdInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") sendTwinCommand();
  });

  /* Boot banner, exactly like the real sketch prints on power-up. */
  serialPrint("==================================================");
  serialPrint("   SMART DUSTBIN - EMBEDDED SYSTEM");
  serialPrint("   Device  : BIN-SIM");
  serialPrint("   Firmware: v1.0.0");
  serialPrint("   Bin height     : 30.0 cm");
  serialPrint("   Hand threshold : 25.0 cm");
  serialPrint("   Warn / Full    : 75 % / 90 %");
  serialPrint("==================================================");
  serialPrint("Power-on self test ... OK");
  serialPrint("System running. Type HELP for commands.", "dim");

  /* The simulated loop(): 20 frames per second, plus telemetry every 2 s. */
  let lastTelemetry = 0;
  const simStart = Date.now();

  syncSliders();
  setInterval(function () {
    const now = Date.now() - simStart;
    twin.step(now);
    view.render(twin);

    document.getElementById("twinLid").textContent    = twin.lidState;
    document.getElementById("twinStatus").textContent = twin.binStatus;
    document.getElementById("twinFill").textContent   = Math.round(twin.fillPercent) + "%";
    document.getElementById("twinSpread").textContent =
      Math.round(twin.fillSpread) + "%" + (twin.unevenLoad ? " !" : "");
    document.getElementById("twinSensors").textContent = twin.validSensors + " / 2";
    document.getElementById("twinGreen").textContent  = twin.ledGreen ? "ON" : "OFF";
    document.getElementById("twinRed").textContent    = twin.ledRed   ? "ON" : "OFF";
    document.getElementById("twinBuzzer").textContent =
      !twin.buzzerEnabled ? "MUTED" : (twin.buzzerOn ? "BEEP" : "SILENT");
    document.getElementById("twinOpens").textContent  = twin.openCount;

    if (now - lastTelemetry >= 2000) {
      lastTelemetry = now;
      serialPrint("[" + Math.floor(now / 1000) + "s] " + twin.telemetryLine());
      serialPrint(twin.jsonLine(), "dim");
    }
  }, 50);

  /* =====================================================================
     6. WOKWI EMBED
     =================================================================== */
  const WOKWI_KEY = "smartdustbin.wokwi";

  function loadWokwi(id) {
    id = String(id).trim().replace(/[^0-9]/g, "");
    const holder = document.getElementById("wokwiHolder");

    if (!id) {
      toast("Enter the numeric Wokwi project ID from the project URL.");
      return;
    }

    holder.innerHTML =
      '<iframe class="wokwi-frame" title="Wokwi simulation" loading="lazy" ' +
      'src="https://wokwi.com/projects/' + id + '"></iframe>' +
      '<p class="muted" style="margin:.6rem 0 0">' +
      'Project <a href="https://wokwi.com/projects/' + id + '" target="_blank" ' +
      'rel="noopener">' + id + '</a>. Press the green play button inside the frame ' +
      'to start the simulation, then click a sensor to change its distance.</p>';

    try { localStorage.setItem(WOKWI_KEY, id); } catch (e) {}
  }

  document.getElementById("wokwiLoad").addEventListener("click", function () {
    loadWokwi(document.getElementById("wokwiId").value);
  });

  try {
    const savedWokwi = localStorage.getItem(WOKWI_KEY);
    if (savedWokwi) {
      document.getElementById("wokwiId").value = savedWokwi;
      loadWokwi(savedWokwi);
    }
  } catch (e) {}

  /* =====================================================================
     7. LIVE ESP32 DEVICE
     --------------------------------------------------------------------
     Polls http://<ip>/api/status every 3 seconds. The ESP32 sketch sends
     an Access-Control-Allow-Origin header, which is what lets this page
     read the response from a different origin.
     =================================================================== */
  const devOut = document.getElementById("deviceOut");
  let devTimer = null;

  function devPrint(text, cls) {
    const d = document.createElement("div");
    if (cls) d.className = "c-" + cls;
    d.textContent = text;
    devOut.appendChild(d);
    while (devOut.childNodes.length > 60) devOut.removeChild(devOut.firstChild);
    devOut.scrollTop = devOut.scrollHeight;
  }

  async function pollDevice(ip) {
    try {
      const res = await fetch("http://" + ip + "/api/status", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      devPrint(clockTime(Date.now()) + "  " + JSON.stringify(data));

      /* Fold the real reading into the fleet so it shows up on the map. */
      const bin = SD.getBin(data.id);
      if (bin) {
        bin.fill     = data.fill;
        bin.lid      = data.lid;
        bin.online   = true;
        bin.opens    = data.opens;
        bin.lastSeen = Date.now();
        SD.save();
        refresh();
      }
    } catch (err) {
      devPrint("Request failed: " + err.message, "err");
      devPrint("Check that the ESP32 is on this network and that you typed " +
               "the IP address it printed on the serial monitor.", "dim");
    }
  }

  document.getElementById("deviceConnect").addEventListener("click", function () {
    const ip = document.getElementById("deviceIp").value.trim();
    if (!ip) { toast("Enter the IP address the ESP32 printed."); return; }

    clearInterval(devTimer);
    devOut.innerHTML = "";
    devPrint("Polling http://" + ip + "/api/status every 3 s ...", "in");
    pollDevice(ip);
    devTimer = setInterval(() => pollDevice(ip), 3000);
    toast("Connecting to " + ip);
  });

  document.getElementById("deviceStop").addEventListener("click", function () {
    clearInterval(devTimer);
    devTimer = null;
    devPrint("Polling stopped.", "warn");
  });

  /* =====================================================================
     Smooth in-page navigation
     =================================================================== */
  document.querySelectorAll('.nav a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      const t = document.querySelector(a.getAttribute("href"));
      if (!t) return;
      e.preventDefault();
      t.scrollIntoView({ behavior: "smooth" });
    });
  });

})();

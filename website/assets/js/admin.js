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

  /* ---- role and permissions ------------------------------------------
     The registry in users.js decides what this person may do. A viewer sees
     everything and can change nothing; the controls are disabled rather
     than hidden, so it is obvious the capability exists and is withheld. */
  const perms = Users.permissions(session.role);
  const roleLabel = Users.roleLabel(session.role);

  document.getElementById("whoami").textContent  = session.name + " (" + roleLabel + ")";
  document.getElementById("footUser").textContent = session.username;

  /* The Users link only exists for a role that may actually use it. The
     page guards itself as well - hiding a link is presentation, not
     security. */
  if (perms.canManageUsers) {
    const link = document.getElementById("usersLink");
    if (link) link.classList.remove("hidden");
  }

  /* If the guard on users.html bounced someone back, say why rather than
     silently returning them to the dashboard. */
  try {
    const denied = sessionStorage.getItem("smartdustbin.denied");
    if (denied) {
      sessionStorage.removeItem("smartdustbin.denied");
      setTimeout(function () {
        toast("Only the Owner can open " + denied + ".");
      }, 400);
    }
  } catch (e) {}

  if (!perms.canControlBins) {
    const banner = document.getElementById("readOnlyBanner");
    if (banner) {
      banner.innerHTML =
        "<b>Read-only session.</b> You are signed in as <b>" + escapeHtml(roleLabel) +
        "</b>, so fleet controls are disabled. Administrator access is granted " +
        "through Google sign-in to accounts listed in the user registry.";
      banner.classList.remove("hidden");
    }
  }

  /* A Google session carries a real profile picture; the demo one does not. */
  if (session.picture) {
    const av = document.getElementById("whoAvatar");
    av.src = session.picture;
    av.alt = session.name;
    av.classList.remove("hidden");
  }

  document.getElementById("logoutBtn").addEventListener("click", function () {
    /* Stop Google silently re-signing the user in on the next visit. */
    if (session.method === "google" && window.google && google.accounts && google.accounts.id) {
      try { google.accounts.id.disableAutoSelect(); } catch (e) {}
    }
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
      if (!perms.canControlBins) { btn.disabled = true; btn.title = "Read-only session"; }
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!perms.canControlBins) { toast("Read-only session."); return; }
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

    /* On phones the per-row Collect button is hidden and the control panel
       sits above the table, so a tap on a row would otherwise appear to do
       nothing. Bring the panel to the user instead. */
    if (window.matchMedia("(max-width: 640px)").matches) {
      const panel = document.getElementById("controlPanel");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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
    if (!perms.canControlBins) { btn.disabled = true; btn.title = "Read-only session"; }
    btn.addEventListener("click", function () {
      if (!perms.canControlBins) { toast("Read-only session - control is not permitted."); return; }
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
    if (!perms.canBulkAct) { toast("Read-only session."); return; }
    const n = SD.sendBulk("MUTE", b => SD.statusOf(b) === "full");
    toast(n ? "Muted " + n + " full bin(s)." : "No full bins right now.");
    refresh();
  });

  /* A nearest-neighbour route: start at the fullest bin, then repeatedly
     drive to the closest bin still on the list. This is the classic greedy
     solution to the travelling salesman problem - good enough for a van. */
  document.getElementById("bulkRoute").addEventListener("click", function () {
    if (!perms.canPlanRoute) { toast("Read-only session."); return; }
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
    if (!perms.canResetDemo) { toast("Read-only session."); return; }
    if (!confirm("Reset all demo bins to their starting values?")) return;
    SD.reset();
    selectedId = null;
    document.getElementById("routeOut").textContent = "";
    toast("Demo data reset.");
    refresh();
  });

  if (!perms.canBulkAct) {
    ["bulkMute", "resetDemo"].forEach(function (id) {
      const b = document.getElementById(id);
      if (b) { b.disabled = true; b.title = "Read-only session"; }
    });
  }

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
     The wiring lives in simulator.js because the public page runs the
     same panel. One implementation, so the two cannot drift apart.
     =================================================================== */
  initSimulator("[data-simulator]", { deviceId: "BIN-SIM" });


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

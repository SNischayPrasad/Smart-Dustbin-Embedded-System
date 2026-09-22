/* ==========================================================================
   public.js - behaviour for the public landing page (read only)
   ========================================================================== */
(function () {

  const map = new BinMap("publicMap", {
    interactive: true,
    onSelect: function (binId) {
      const row = document.querySelector('tr[data-bin="' + binId + '"]');
      if (row) {
        document.querySelectorAll("#publicBinRows tr").forEach(r => r.classList.remove("selected"));
        row.classList.add("selected");
        row.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  });

  function renderKpis() {
    const s = SD.summary();
    document.getElementById("kTotal").textContent = s.total;
    document.getElementById("kOk").textContent    = s.ok;
    document.getElementById("kWarn").textContent  = s.warning;
    document.getElementById("kFull").textContent  = s.full;
    document.getElementById("kAvg").textContent   = s.avgFill + "%";
    const zones = document.getElementById("kZones");
    if (zones) zones.textContent = "across " + SD.getZones().length + " zones";
  }

  /* The pill under the heading says whether these numbers are the shared
     city fleet or this browser's own demo copy.

     A visitor is not the right audience for a cloud error: the page falls
     back to the same simulation it has always run, so nothing is broken from
     where they are standing. They get the honest label - this browser's own
     copy - and the reason waits in the tooltip for whoever is debugging.  */
  function renderCloud() {
    const pill = document.getElementById("cloudPill");
    if (!pill) return;

    const s = (typeof FleetCloud !== "undefined") ? FleetCloud.status() : { state: "off" };
    const live = s.state === "live";

    pill.setAttribute("data-state", live ? "live" : (s.state === "connecting" ? "connecting" : "local"));
    pill.textContent = live ? "Live city data"
                    : s.state === "connecting" ? "Connecting..."
                    : "Demo data - this browser";
    pill.title = live
      ? "Shared with the admin console and the collection crew"
      : s.state === "error"
        ? "The shared fleet is unreachable, so this page is simulating it locally" +
          (s.error && s.error.code ? " (" + s.error.code + ")" : "")
        : "Simulated in this browser - no shared fleet configured";
  }

  function renderTable() {
    const rows = SD.getFleet().map(function (bin) {
      const status = SD.statusOf(bin);
      const fill   = Math.round(bin.fill);
      return '' +
        '<tr data-bin="' + bin.id + '">' +
          '<td><b>' + escapeHtml(bin.id) + '</b></td>' +
          '<td>' + escapeHtml(bin.name) + '</td>' +
          '<td>' + escapeHtml(bin.zone) + '</td>' +
          '<td>' + escapeHtml(bin.category) + '</td>' +
          '<td>' +
            '<div class="fill-bar"><span class="fill-' + status +
              '" style="width:' + (bin.online ? fill : 0) + '%"></span></div>' +
            '<span class="muted">' + (bin.online ? fill + "%" : "no data") + '</span>' +
          '</td>' +
          '<td><span class="badge badge-' + status + '">' +
            '<span class="dot"></span>' + SD.statusLabel(status) + '</span>' +
            (bin.locked ? ' <span class="badge-locked">LOCKED</span>' : '') + '</td>' +
          '<td class="muted">' + timeAgo(bin.lastSeen) + '</td>' +
        '</tr>';
    }).join("");

    document.getElementById("publicBinRows").innerHTML = rows;

    document.querySelectorAll("#publicBinRows tr").forEach(function (tr) {
      tr.addEventListener("click", function () {
        const id = tr.getAttribute("data-bin");
        document.querySelectorAll("#publicBinRows tr").forEach(r => r.classList.remove("selected"));
        tr.classList.add("selected");
        map.select(id);
        map.flyTo(id);
      });
    });
  }

  function refresh() {
    renderKpis();
    renderTable();
    renderCloud();
    map.setBins(SD.getFleet());
    document.getElementById("lastUpdate").textContent =
      "updated " + clockTime(Date.now());
  }

  /* The firmware twin - the same panel the admin console runs, from the
     same module, so the two cannot drift apart. */
  initSimulator("[data-simulator]", { deviceId: "BIN-DEMO" });

  /* The shared fleet. Anything a collector or an administrator does - or a
     real bin reports - arrives here within a second, with no refresh. */
  if (typeof FleetCloud !== "undefined") {
    FleetCloud.onStatus(renderCloud);
    FleetCloud.start();
  }
  if (typeof SD.onChange === "function") {
    SD.onChange(function () { SD.tick(); refresh(); });
  }

  /* First paint, then a live tick every 5 seconds. */
  SD.tick();
  refresh();
  map.fitAll();

  setInterval(function () {
    SD.tick();
    refresh();
  }, 5000);

  /* Smooth scrolling for the in-page navigation links. */
  document.querySelectorAll('.nav a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      const target = document.querySelector(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth" });
      document.querySelectorAll(".nav a").forEach(n => n.classList.remove("active"));
      a.classList.add("active");
    });
  });
})();

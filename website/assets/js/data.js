/* ==========================================================================
   data.js - the fleet data layer
   --------------------------------------------------------------------------
   In a production deployment this file would be replaced by calls to a real
   backend (see server/server.js for a working Node/Express version).
   Here the fleet lives in localStorage so the demo runs from a plain file://
   URL with zero setup, and any control you send from the dashboard survives
   a page reload - exactly like a real system would behave.
   ========================================================================== */

const SD = (function () {

  const STORAGE_KEY = "smartdustbin.fleet.v1";
  const LOG_KEY     = "smartdustbin.log.v1";

  /* ---- Thresholds: identical numbers to the Arduino firmware ---------- */
  const CONFIG = {
    BIN_HEIGHT_CM:      30,
    HAND_DETECT_CM:     25,
    WARN_PERCENT:       75,
    FULL_PERCENT:       90,
    LID_OPEN_HOLD_MS:   3000,
    OFFLINE_AFTER_MIN:  30
  };

  /* ---- Seed fleet: 16 bins across Hyderabad -------------------------- */
  const SEED = [
    { id:"BIN-001", name:"Charminar Plaza",          zone:"Old City",     category:"Public Square", lat:17.3616, lng:78.4747, fill:34, capacity:120 },
    { id:"BIN-002", name:"Secunderabad Station P1",  zone:"Central",      category:"Railway",       lat:17.4340, lng:78.5013, fill:92, capacity:240 },
    { id:"BIN-003", name:"RGIA Terminal 2 Arrivals", zone:"Shamshabad",   category:"Airport",       lat:17.2403, lng:78.4294, fill:61, capacity:240 },
    { id:"BIN-004", name:"Gandhi Hospital Ward B",   zone:"Central",      category:"Hospital",      lat:17.4399, lng:78.4983, fill:78, capacity:80  },
    { id:"BIN-005", name:"Inorbit Mall Food Court",  zone:"Madhapur",     category:"Mall",          lat:17.4345, lng:78.3866, fill:88, capacity:180 },
    { id:"BIN-006", name:"HITEC City Metro Gate 2",  zone:"Madhapur",     category:"Metro",         lat:17.4483, lng:78.3915, fill:45, capacity:120 },
    { id:"BIN-007", name:"MRCET Campus Block A",     zone:"Maisammaguda", category:"Campus",        lat:17.5560, lng:78.4483, fill:22, capacity:80  },
    { id:"BIN-008", name:"Tank Bund Walkway",        zone:"Central",      category:"Public Square", lat:17.4239, lng:78.4738, fill:67, capacity:120 },
    { id:"BIN-009", name:"Necklace Road Park",       zone:"Central",      category:"Park",          lat:17.4180, lng:78.4670, fill:15, capacity:120 },
    { id:"BIN-010", name:"Begumpet Office Park",     zone:"Begumpet",     category:"Office",        lat:17.4435, lng:78.4645, fill:53, capacity:80  },
    { id:"BIN-011", name:"KPHB Market Lane 4",       zone:"Kukatpally",   category:"Market",        lat:17.4849, lng:78.3915, fill:95, capacity:180 },
    { id:"BIN-012", name:"Gachibowli Stadium G3",    zone:"Gachibowli",   category:"Stadium",       lat:17.4239, lng:78.3448, fill:8,  capacity:240 },
    { id:"BIN-013", name:"Osmania Univ Library",     zone:"Amberpet",     category:"Campus",        lat:17.4065, lng:78.5265, fill:41, capacity:80  },
    { id:"BIN-014", name:"Uppal Industrial Estate",  zone:"Uppal",        category:"Industrial",    lat:17.4055, lng:78.5600, fill:72, capacity:240 },
    { id:"BIN-015", name:"Kukatpally Bus Depot",     zone:"Kukatpally",   category:"Transit",       lat:17.4948, lng:78.3996, fill:80, capacity:180 },
    { id:"BIN-016", name:"Golconda Fort Entrance",   zone:"Golconda",     category:"Tourist",       lat:17.3833, lng:78.4011, fill:29, capacity:120 }
  ];

  /* ---- Build a full bin record from the seed ------------------------- */
  function hydrate(seed, index) {
    return {
      id:        seed.id,
      name:      seed.name,
      zone:      seed.zone,
      category:  seed.category,
      lat:       seed.lat,
      lng:       seed.lng,
      fill:      seed.fill,
      capacity:  seed.capacity,
      lid:       "CLOSED",
      muted:     false,
      manual:    false,
      online:    index !== 11,              /* BIN-012 starts offline on purpose */
      battery:   72 + ((index * 7) % 28),
      rssi:      -45 - ((index * 5) % 40),
      opens:     40 + ((index * 37) % 260),
      firmware:  "1.0.0",
      installed: "2026-0" + (1 + (index % 8)) + "-1" + (index % 9),
      lastSeen:  Date.now() - (index === 11 ? 4 * 3600e3 : (index * 17e3))
    };
  }

  /* ---- Storage ------------------------------------------------------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === SEED.length) return parsed;
      }
    } catch (e) { /* corrupted or storage blocked - fall through to seed */ }
    return SEED.map(hydrate);
  }

  function save(fleet) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fleet)); }
    catch (e) { /* private mode - the demo still works in memory */ }
  }

  let fleet = load();

  /* ---- Derived values ------------------------------------------------ */

  /* Same formula as the firmware, run backwards: given a fill percentage,
     what distance would the ultrasonic sensor be reporting?              */
  function fillToDistance(fillPercent) {
    return +(CONFIG.BIN_HEIGHT_CM * (1 - fillPercent / 100)).toFixed(1);
  }

  function distanceToFill(distanceCm) {
    let d = Math.min(Math.max(distanceCm, 0), CONFIG.BIN_HEIGHT_CM);
    return Math.round(((CONFIG.BIN_HEIGHT_CM - d) / CONFIG.BIN_HEIGHT_CM) * 100);
  }

  function statusOf(bin) {
    if (!bin.online)                       return "offline";
    if (bin.fill >= CONFIG.FULL_PERCENT)   return "full";
    if (bin.fill >= CONFIG.WARN_PERCENT)   return "warning";
    return "ok";
  }

  function statusLabel(s) {
    return { ok:"Normal", warning:"Near full", full:"Full", offline:"Offline" }[s] || s;
  }

  function summary() {
    const s = { total: fleet.length, ok:0, warning:0, full:0, offline:0, avgFill:0, totalOpens:0 };
    let onlineFill = 0, onlineCount = 0;
    fleet.forEach(b => {
      const st = statusOf(b);
      s[st]++;
      s.totalOpens += b.opens;
      if (b.online) { onlineFill += b.fill; onlineCount++; }
    });
    s.avgFill = onlineCount ? Math.round(onlineFill / onlineCount) : 0;
    return s;
  }

  /* ---- Activity log -------------------------------------------------- */
  function loadLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY)) || []; }
    catch (e) { return []; }
  }
  let log = loadLog();

  function addLog(binId, message, level) {
    log.unshift({ t: Date.now(), binId: binId, msg: message, level: level || "info" });
    log = log.slice(0, 60);                 /* keep the feed short */
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch (e) {}
    return log[0];
  }

  function getLog() { return log; }

  /* ---- Commands: the dashboard equivalent of the serial commands ----- */
  const COMMANDS = {
    OPEN:   b => { b.lid = "OPEN";   b.manual = true;  return "Lid forced open"; },
    CLOSE:  b => { b.lid = "CLOSED"; b.manual = true;  return "Lid forced closed"; },
    AUTO:   b => { b.manual = false;                   return "Returned to automatic mode"; },
    MUTE:   b => { b.muted  = true;                    return "Buzzer muted"; },
    UNMUTE: b => { b.muted  = false;                   return "Buzzer enabled"; },
    EMPTY:  b => { b.fill   = 0; b.opens = 0;          return "Marked as collected"; },
    PING:   b => { b.online = true; b.lastSeen = Date.now(); return "Device responded"; }
  };

  function sendCommand(binId, cmd) {
    const bin = fleet.find(b => b.id === binId);
    if (!bin) return { ok:false, message:"Unknown bin " + binId };

    const fn = COMMANDS[cmd];
    if (!fn) return { ok:false, message:"Unknown command " + cmd };

    if (!bin.online && cmd !== "PING") {
      addLog(binId, cmd + " failed - device offline", "error");
      return { ok:false, message:"Device is offline. Try PING first." };
    }

    const result = fn(bin);
    bin.lastSeen = Date.now();
    save(fleet);
    addLog(binId, result, cmd === "EMPTY" ? "success" : "info");
    return { ok:true, message:result };
  }

  /* Apply one command to every bin that passes a filter. */
  function sendBulk(cmd, filterFn) {
    let count = 0;
    fleet.filter(filterFn).forEach(b => {
      if (sendCommand(b.id, cmd).ok) count++;
    });
    return count;
  }

  /* ---- Simulated telemetry tick --------------------------------------
     Every tick each bin fills up a little, the way real bins do. Busy
     categories (railway, mall, market) fill faster than a quiet park.
     This is what makes the map feel alive during a demo or a viva.     */
  const FILL_RATE = {
    Railway:1.5, Mall:1.3, Market:1.4, Airport:1.2, Transit:1.1, Metro:1.0,
    "Public Square":0.9, Hospital:0.8, Office:0.6, Campus:0.5, Stadium:0.4,
    Park:0.3, Tourist:0.7, Industrial:0.6
  };

  function tick() {
    const events = [];
    fleet.forEach(bin => {
      if (!bin.online) return;

      const before = statusOf(bin);
      const rate   = FILL_RATE[bin.category] || 0.8;

      /* Random walk that mostly climbs - people keep throwing rubbish. */
      bin.fill = Math.min(100, Math.max(0, bin.fill + (Math.random() * rate)));
      bin.fill = Math.round(bin.fill * 10) / 10;

      /* Occasionally somebody uses the bin, so the lid cycles. */
      if (!bin.manual && Math.random() < 0.12) {
        bin.lid   = "OPEN";
        bin.opens = bin.opens + 1;
        setTimeout(() => { if (!bin.manual) bin.lid = "CLOSED"; save(fleet); },
                   CONFIG.LID_OPEN_HOLD_MS);
      }

      bin.battery  = Math.max(5, +(bin.battery - 0.01).toFixed(2));
      bin.lastSeen = Date.now();

      /* A full bin eventually gets collected - that is the whole point of the
         alert. Without this the demo saturates: leave the page open for an
         hour and every bin reads 100%, which looks broken rather than busy. */
      if (bin.fill >= CONFIG.FULL_PERCENT && Math.random() < 0.08) {
        bin.fill  = Math.round(Math.random() * 8);
        bin.opens = 0;
        addLog(bin.id, "Collected by crew - bin emptied", "success");
      }

      const after = statusOf(bin);
      if (after !== before) {
        const msg = after === "full"    ? "Bin is FULL - collection required"
                  : after === "warning" ? "Crossed 75% - schedule a pickup"
                  : "Status returned to normal";
        events.push(addLog(bin.id, msg, after === "full" ? "error"
                                      : after === "warning" ? "warn" : "success"));
      }
    });
    save(fleet);
    return events;
  }

  /* ---- Public API ---------------------------------------------------- */
  return {
    CONFIG: CONFIG,
    getFleet:  () => fleet,
    getBin:    id => fleet.find(b => b.id === id),
    getZones:  () => [...new Set(fleet.map(b => b.zone))].sort(),
    summary:   summary,
    statusOf:  statusOf,
    statusLabel: statusLabel,
    fillToDistance: fillToDistance,
    distanceToFill: distanceToFill,
    sendCommand: sendCommand,
    sendBulk:    sendBulk,
    addLog:      addLog,
    getLog:      getLog,
    tick:        tick,
    save:      () => save(fleet),
    reset:     () => {
      fleet = SEED.map(hydrate);
      log = [];
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LOG_KEY);
      } catch (e) {}
      return fleet;
    }
  };
})();

/* ---- Small formatting helpers shared by both pages -------------------- */
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return s + "s ago";
  if (s < 3600)  return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

function clockTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

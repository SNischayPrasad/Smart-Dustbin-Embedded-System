/* ==========================================================================
   data.js - the fleet data layer
   --------------------------------------------------------------------------
   WHY A BIN'S FILL IS A FUNCTION OF THE CLOCK
   The website has no real boards for 48 bins, so it simulates them - and it
   must simulate them the SAME way in every browser, or two people looking at
   the shared city dashboard would see different numbers. So the fill is not
   a stored random walk: it is computed from the time of day (a steady fill
   rate per kind of place, a crew that empties a full bin an hour after it
   fills, repeat). Every screen asking "how full is BIN-021 at 10:42?" gets
   the same answer, with zero network traffic and zero database writes.

   The only MUTABLE state is a small per-bin "overlay" of what people and
   devices actually did: "collected at 10:40 by the crew", "lid forced open",
   "buzzer muted", "the real ESP32 says 72 %". Overlays live in localStorage
   (local demo) or arrive from Firestore through FleetCloud (fleet-cloud.js),
   which is how a collector's "Mark collected" on a phone reaches the office
   dashboard a second later.

   LOCKDOWN mirrors the firmware: a bin at or above FULL_PERCENT is locked -
   a hand does not open it (so the lid never shows OPEN) until a crew member
   forces it open with the OPEN command, or it is emptied.

   This file also runs under Node for tests/fleet.test.js, so every browser
   global (localStorage, FleetCloud, AUTH) is guarded.
   ========================================================================== */

const SD = (function () {

  /* v2 stores overlays, not whole bins - the v1 keys held a private random
     walk that no other browser could reproduce, so they are dropped. */
  const OVERLAY_KEY = "smartdustbin.overlay.v2";
  const LOG_KEY     = "smartdustbin.log.v2";
  const OLD_KEYS    = ["smartdustbin.fleet.v1", "smartdustbin.log.v1"];
  const LOG_MAX     = 60;                   /* keep the local feed short */

  /* ---- Thresholds: identical numbers to the Arduino firmware ---------- */
  const CONFIG = {
    BIN_HEIGHT_CM:      30,
    HAND_DETECT_CM:     25,
    WARN_PERCENT:       75,
    FULL_PERCENT:       90,
    LID_OPEN_HOLD_MS:   3000,
    OFFLINE_AFTER_MIN:  30,
    DEVICE_STALE_MIN:   2                   /* a real board silent this long is offline */
  };

  /* ---- Seed fleet: 48 bins across Hyderabad --------------------------
     fill = the fill % at EPOCH. offline:true = a dead device (it answers a
     PING, which revives it). BIN-001..016 are the original fleet;
     BIN-017..048 were geocoded from OpenStreetMap place names.          */
  const SEED = [
    { id:"BIN-001", name:"Charminar Plaza",             zone:"Old City",       category:"Public Square",  lat:17.3616, lng:78.4747, fill:34, capacity:120 },
    { id:"BIN-002", name:"Secunderabad Station P1",     zone:"Central",        category:"Railway",        lat:17.4340, lng:78.5013, fill:92, capacity:240 },
    { id:"BIN-003", name:"RGIA Terminal 2 Arrivals",    zone:"Shamshabad",     category:"Airport",        lat:17.2403, lng:78.4294, fill:61, capacity:240 },
    { id:"BIN-004", name:"Gandhi Hospital Ward B",      zone:"Central",        category:"Hospital",       lat:17.4399, lng:78.4983, fill:78, capacity:80  },
    { id:"BIN-005", name:"Inorbit Mall Food Court",     zone:"Madhapur",       category:"Mall",           lat:17.4345, lng:78.3866, fill:88, capacity:180 },
    { id:"BIN-006", name:"HITEC City Metro Gate 2",     zone:"Madhapur",       category:"Metro",          lat:17.4483, lng:78.3915, fill:45, capacity:120 },
    { id:"BIN-007", name:"MRCET Campus Block A",        zone:"Maisammaguda",   category:"Campus",         lat:17.5560, lng:78.4483, fill:22, capacity:80  },
    { id:"BIN-008", name:"Tank Bund Walkway",           zone:"Central",        category:"Public Square",  lat:17.4239, lng:78.4738, fill:67, capacity:120 },
    { id:"BIN-009", name:"Necklace Road Park",          zone:"Central",        category:"Park",           lat:17.4180, lng:78.4670, fill:15, capacity:120 },
    { id:"BIN-010", name:"Begumpet Office Park",        zone:"Begumpet",       category:"Office",         lat:17.4435, lng:78.4645, fill:53, capacity:80  },
    { id:"BIN-011", name:"KPHB Market Lane 4",          zone:"Kukatpally",     category:"Market",         lat:17.4849, lng:78.3915, fill:95, capacity:180 },
    { id:"BIN-012", name:"Gachibowli Stadium G3",       zone:"Gachibowli",     category:"Stadium",        lat:17.4239, lng:78.3448, fill:8,  capacity:240, offline:true },
    { id:"BIN-013", name:"Osmania Univ Library",        zone:"Amberpet",       category:"Campus",         lat:17.4065, lng:78.5265, fill:41, capacity:80  },
    { id:"BIN-014", name:"Uppal Industrial Estate",     zone:"Uppal",          category:"Industrial",     lat:17.4055, lng:78.5600, fill:72, capacity:240 },
    { id:"BIN-015", name:"Kukatpally Bus Depot",        zone:"Kukatpally",     category:"Transit",        lat:17.4948, lng:78.3996, fill:80, capacity:180 },
    { id:"BIN-016", name:"Golconda Fort Entrance",      zone:"Golconda",       category:"Tourist",        lat:17.3833, lng:78.4011, fill:29, capacity:120 },
    { id:"BIN-017", name:"Ameerpet Metro Interchange",  zone:"Ameerpet",       category:"Metro",          lat:17.4355, lng:78.4446, fill:58, capacity:240 },
    { id:"BIN-018", name:"NIMS Hospital Punjagutta",    zone:"Punjagutta",     category:"Hospital",       lat:17.4222, lng:78.4518, fill:83, capacity:120 },
    { id:"BIN-019", name:"Abids Shopping Area",         zone:"Abids",          category:"Market",         lat:17.3895, lng:78.4772, fill:91, capacity:180 },
    { id:"BIN-020", name:"Koti Sultan Bazar",           zone:"Koti",           category:"Market",         lat:17.3870, lng:78.4870, fill:47, capacity:180 },
    { id:"BIN-021", name:"Nampally Railway Station",    zone:"Nampally",       category:"Railway",        lat:17.3924, lng:78.4676, fill:94, capacity:240 },
    { id:"BIN-022", name:"MGBS Bus Station",            zone:"Afzalgunj",      category:"Transit",        lat:17.3781, lng:78.4851, fill:79, capacity:240 },
    { id:"BIN-023", name:"JBS Jubilee Bus Station",     zone:"Secunderabad",   category:"Transit",        lat:17.4488, lng:78.4965, fill:36, capacity:240 },
    { id:"BIN-024", name:"Paradise Circle",             zone:"Secunderabad",   category:"Public Square",  lat:17.4415, lng:78.4873, fill:86, capacity:180 },
    { id:"BIN-025", name:"KBR National Park",           zone:"Jubilee Hills",  category:"Park",           lat:17.4203, lng:78.4205, fill:12, capacity:120 },
    { id:"BIN-026", name:"Salar Jung Museum",           zone:"Darulshifa",     category:"Tourist",        lat:17.3714, lng:78.4801, fill:64, capacity:180 },
    { id:"BIN-027", name:"Lumbini Park",                zone:"Khairatabad",    category:"Park",           lat:17.4097, lng:78.4728, fill:27, capacity:180 },
    { id:"BIN-028", name:"Birla Mandir",                zone:"Khairatabad",    category:"Tourist",        lat:17.4057, lng:78.4693, fill:76, capacity:120 },
    { id:"BIN-029", name:"LB Stadium",                  zone:"Basheerbagh",    category:"Stadium",        lat:17.3996, lng:78.4730, fill:5,  capacity:240 },
    { id:"BIN-030", name:"Sarath City Capital Mall",    zone:"Kondapur",       category:"Mall",           lat:17.4577, lng:78.3639, fill:93, capacity:240 },
    { id:"BIN-031", name:"Miyapur Metro Station",       zone:"Miyapur",        category:"Metro",          lat:17.4964, lng:78.3727, fill:81, capacity:240 },
    { id:"BIN-032", name:"Financial District",          zone:"Nanakramguda",   category:"Office",         lat:17.4044, lng:78.3418, fill:49, capacity:120 },
    { id:"BIN-033", name:"University of Hyderabad",     zone:"Gachibowli",     category:"Campus",         lat:17.4530, lng:78.3270, fill:18, capacity:120 },
    { id:"BIN-034", name:"Mindspace IT Park",           zone:"Madhapur",       category:"Office",         lat:17.4403, lng:78.3800, fill:91, capacity:120 },
    { id:"BIN-035", name:"JNTU Hyderabad",              zone:"Kukatpally",     category:"Campus",         lat:17.4931, lng:78.3914, fill:38, capacity:120 },
    { id:"BIN-036", name:"Mehdipatnam Centre",          zone:"Mehdipatnam",    category:"Public Square",  lat:17.3943, lng:78.4343, fill:70, capacity:180 },
    { id:"BIN-037", name:"Nehru Zoological Park",       zone:"Bahadurpura",    category:"Tourist",        lat:17.3514, lng:78.4456, fill:84, capacity:180 },
    { id:"BIN-038", name:"Shamshabad Town Centre",      zone:"Shamshabad",     category:"Market",         lat:17.2611, lng:78.3932, fill:62, capacity:120, offline:true },
    { id:"BIN-039", name:"Falaknuma Railway Station",   zone:"Falaknuma",      category:"Railway",        lat:17.3327, lng:78.4752, fill:95, capacity:180 },
    { id:"BIN-040", name:"Kompally Bus Stop",           zone:"Kompally",       category:"Transit",        lat:17.5401, lng:78.4909, fill:55, capacity:180 },
    { id:"BIN-041", name:"Medchal Railway Station",     zone:"Medchal",        category:"Railway",        lat:17.6399, lng:78.4753, fill:77, capacity:180 },
    { id:"BIN-042", name:"Alwal Town Centre",           zone:"Alwal",          category:"Market",         lat:17.5022, lng:78.5089, fill:33, capacity:120 },
    { id:"BIN-043", name:"IDA Jeedimetla",              zone:"Jeedimetla",     category:"Industrial",     lat:17.5204, lng:78.4514, fill:92, capacity:240 },
    { id:"BIN-044", name:"ECIL Bus Station",            zone:"ECIL",           category:"Transit",        lat:17.4725, lng:78.5701, fill:87, capacity:240 },
    { id:"BIN-045", name:"LB Nagar Metro Station",      zone:"LB Nagar",       category:"Metro",          lat:17.3498, lng:78.5479, fill:44, capacity:240 },
    { id:"BIN-046", name:"Dilsukhnagar Bus Station",    zone:"Dilsukhnagar",   category:"Transit",        lat:17.3690, lng:78.5251, fill:91, capacity:240 },
    { id:"BIN-047", name:"Cherlapally Railway Stn",     zone:"Cherlapally",    category:"Railway",        lat:17.4590, lng:78.6043, fill:68, capacity:240 },
    { id:"BIN-048", name:"Uppal Cricket Stadium",       zone:"Uppal",          category:"Stadium",        lat:17.4059, lng:78.5506, fill:82, capacity:240 }
  ];
  SEED.forEach(Object.freeze);              /* read-only: state lives in overlays */

  const SEED_BY_ID = {};
  SEED.forEach(function (s) { SEED_BY_ID[s.id] = s; });

  /* ---- Time model ------------------------------------------------------
     A fixed reference instant plus a fill rate per kind of place. Busy
     places (a railway platform) fill in about 2.5 hours; a park takes 10. */
  const EPOCH = Date.UTC(2026, 8, 22, 0, 0, 0);
  const RATE_PER_HOUR = {
    Railway:40, Market:36, Mall:34, Airport:32, Transit:30, Metro:28,
    "Public Square":24, Tourist:22, Hospital:20, Industrial:18, Office:16,
    Campus:14, Stadium:12, Park:10
  };
  const DEFAULT_RATE      = 20;
  const FULL_GRACE_H      = 1;              /* simulated crew empties a bin 1 h after 100 % */
  const HOUR_MS           = 3600e3;
  const LID_SLOT_MS       = 4000;           /* every browser shares the same 4 s lid slot */
  const LID_OPEN_CHANCE   = 0.12;
  const SEEN_SLOT_MS      = 20000;
  const OPENS_PER_PERCENT = 1.5;            /* about 1.5 uses per % of fill */
  const RESIDUAL_MAX      = 4;              /* an emptied bin is never perfectly clean */
  const OPTIMISTIC_MS     = 15000;          /* how long a local change waits for the cloud echo */
  const LOG_MATCH_MS      = 120000;         /* local entry vs its cloud echo: clock skew allowance */

  /* FNV-1a, 32 bit. A tiny, well-known hash: the same string gives the same
     number in every browser, which is all the "randomness" here needs.   */
  function hash32(str) {
    str = String(str);
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function rand01(str) { return hash32(str) / 4294967296; }

  /* % per hour for one bin: its category's rate, nudged 0.8x - 1.2x so two
     metro stations do not fill in lock-step. */
  function rateOf(seed) {
    const base = RATE_PER_HOUR[seed.category] || DEFAULT_RATE;
    return base * (0.8 + 0.4 * rand01(seed.id));
  }

  /* ---- Small value helpers (overlays come from storage and the network,
          so nothing is trusted to have the right type) ------------------ */
  function ms(v) {
    if (typeof v === "number" && isFinite(v)) return v;
    if (v && typeof v.toMillis === "function") return v.toMillis();   /* a stray Firestore Timestamp */
    if (v instanceof Date) return v.getTime();
    return 0;
  }
  function numOr(v, dflt) { return (typeof v === "number" && isFinite(v)) ? v : dflt; }
  function intOr(v, dflt) { return (typeof v === "number" && isFinite(v)) ? Math.round(v) : dflt; }
  function clampPct(v)    { return Math.min(100, Math.max(0, numOr(v, 0))); }
  function round1(v)      { return Math.round(v * 10) / 10; }
  function isLidWord(v)   { return v === "OPEN" || v === "CLOSED"; }

  /* The newest moment a person changed this overlay (used to tell whether a
     real device has reported since - until it has, show the change). */
  function changedAt(ov) {
    return Math.max(ms(ov.updatedAt), ms(ov.collectedAt), ov.command ? ms(ov.command.at) : 0);
  }

  /* ---- modelBin: THE function - seed + overlay + time -> a bin record --
     Pure: no Date.now(), no storage. Tests drive it with any `now`.     */
  function modelBin(seed, overlay, now) {
    const ov  = overlay || {};
    const idx = (parseInt(String(seed.id).replace(/\D/g, ""), 10) || 1) - 1;
    const r   = rateOf(seed);

    const bin = {
      id:        seed.id,
      name:      seed.name,
      zone:      seed.zone,
      category:  seed.category,
      lat:       seed.lat,
      lng:       seed.lng,
      capacity:  seed.capacity,
      muted:     !!ov.muted,
      manual:    !!ov.manual,
      battery:   round1(55 + 44 * rand01(seed.id + ":batt")),
      rssi:      -45 - Math.round(40 * rand01(seed.id + ":rssi")),
      firmware:  "1.0.0",
      installed: "2026-0" + (1 + (idx % 8)) + "-1" + (idx % 9),
      rate:      round1(r),                 /* % per hour, for "full in ~40 min" hints */
      collectedAt:     ms(ov.collectedAt) || null,
      collectedByRole: ov.collectedByRole || null,
      /* A command queued for a real device that it has not acknowledged yet. */
      pendingCommand: (ov.command && ov.command.cmd &&
                       !(ov.commandAck && ov.commandAck.id === ov.command.id)) ? ov.command.cmd : null
    };

    if (ov.device && typeof ov.device === "object") return deviceBin(bin, ov, now);

    /* 1. Which cycle are we in? A cycle = fill from ~0 to 100 %, then wait
          FULL_GRACE_H for the crew. The seed cycle is anchored so the bin
          reads exactly seed.fill at EPOCH; an EMPTY restarts from then.   */
    const tFullH     = 100 / r;
    const cycleH     = tFullH + FULL_GRACE_H;
    const seedAnchor = Math.round(EPOCH - (seed.fill / r) * HOUR_MS);
    const collected  = ms(ov.collectedAt);
    const fromSeed   = !(collected > seedAnchor);
    const anchor     = fromSeed ? seedAnchor : collected;
    const online     = ov.online === true ? true : !seed.offline;

    /* A dead device sends nothing, so it stays frozen at its last reading. */
    const t        = online ? now : Math.min(now, Math.max(EPOCH, anchor));
    const totalH   = Math.max(0, (t - anchor) / HOUR_MS);   /* before the anchor = just emptied */
    const cycleNo  = Math.floor(totalH / cycleH);
    const elapsedH = Math.max(0, totalH - cycleNo * cycleH);

    /* 2. Fill: a little residue left by the crew, plus steady filling. */
    const residual = (fromSeed && cycleNo === 0) ? 0
                   : RESIDUAL_MAX * rand01(seed.id + ":" + anchor + ":" + cycleNo);
    const fill     = round1(Math.min(100, residual + r * elapsedH));

    /* 3. Usage: people use it until it locks at FULL, then are turned away. */
    const useH    = CONFIG.FULL_PERCENT / r;
    const opens   = Math.floor(Math.min(elapsedH, useH) * r * OPENS_PER_PERCENT);
    const refused = Math.floor(Math.max(0, elapsedH - useH) * r * OPENS_PER_PERCENT);

    /* 4. LOCKDOWN - identical rule to the firmware: full means locked, and a
          locked lid only opens when a person forces it (manual OPEN).    */
    const locked = online && fill >= CONFIG.FULL_PERCENT;
    let lid;
    if (ov.manual)                lid = isLidWord(ov.lidOverride) ? ov.lidOverride : "CLOSED";
    else if (locked || !online)   lid = "CLOSED";
    else lid = rand01(seed.id + ":" + Math.floor(now / LID_SLOT_MS)) < LID_OPEN_CHANCE ? "OPEN" : "CLOSED";

    const cycleStart = anchor + cycleNo * cycleH * HOUR_MS;

    return Object.assign(bin, {
      fill:     fill,
      fillA:    fill,                       /* a model bin's two sensors agree */
      fillB:    fill,
      lid:      lid,
      locked:   locked,
      opens:    opens,
      refused:  refused,
      online:   online,
      lastSeen: online ? now - 1000 * Math.floor(20 * rand01(seed.id + ":" + Math.floor(now / SEEN_SLOT_MS)))
                       : EPOCH - 4 * HOUR_MS,
      source:   "model",
      deviceStatus: null,
      /* when this cycle crosses FULL_PERCENT (past if it already has) */
      fullAt:   online ? Math.round(cycleStart + ((CONFIG.FULL_PERCENT - residual) / r) * HOUR_MS) : null
    });
  }

  /* A device-linked bin: a real ESP32 (or its Wokwi simulation) reports its
     readings through the cloud, so they replace the model. Until the board
     reports again, a dashboard change made since its last report is shown
     (optimistic), so a button press is visible at once. */
  function deviceBin(bin, ov, now) {
    const dev        = ov.device;
    const reportedAt = ms(dev.reportedAt);
    const online     = reportedAt > 0 && now - reportedAt <= CONFIG.DEVICE_STALE_MIN * 60000;
    const pending    = changedAt(ov) > reportedAt;
    const emptied    = ms(ov.collectedAt) > reportedAt;   /* crew emptied it after the last report */
    const status     = typeof dev.status === "string" ? dev.status : "";
    const devLocked  = typeof dev.locked === "boolean" ? dev.locked : status === "FULL";

    let lid = (typeof dev.lid === "string" && dev.lid) ? dev.lid : "CLOSED";
    if (pending && ov.manual && isLidWord(ov.lidOverride)) lid = ov.lidOverride;

    return Object.assign(bin, {
      fill:     emptied ? 0 : clampPct(dev.fill),
      fillA:    numOr(dev.fillA, null),     /* raw: -1 means that sensor has no echo */
      fillB:    numOr(dev.fillB, null),
      lid:      lid,
      locked:   online && !emptied && devLocked,
      opens:    intOr(dev.opens, 0),
      refused:  emptied ? 0 : intOr(dev.refused, 0),
      online:   online,
      lastSeen: reportedAt || EPOCH,
      source:   "device",
      deviceStatus: status || null,
      errors:   intOr(dev.errors, 0),
      sensors:  intOr(dev.sensors, null),
      rssi:     intOr(dev.rssi, bin.rssi),
      firmware: (typeof dev.firmware === "string" && dev.firmware) ? dev.firmware : bin.firmware,
      manual:   (!pending && typeof dev.manual === "boolean") ? dev.manual : !!ov.manual,
      muted:    (!pending && typeof dev.muted  === "boolean") ? dev.muted  : !!ov.muted,
      fullAt:   null
    });
  }

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
    if (!bin.online)                          return "offline";
    if (bin.deviceStatus === "SENSOR_ERROR")  return "error";    /* level unknown - not "ok" */
    if (bin.fill >= CONFIG.FULL_PERCENT)      return "full";
    if (bin.fill >= CONFIG.WARN_PERCENT)      return "warning";
    return "ok";
  }

  function statusLabel(s) {
    return { ok:"Normal", warning:"Near full", full:"Full", offline:"Offline",
             error:"Sensor fault" }[s] || s;
  }

  /* ---- Browser storage (absent under Node, blocked in private mode) --- */
  function store() {
    try { return (typeof localStorage !== "undefined" && localStorage) ? localStorage : null; }
    catch (e) { return null; }             /* some browsers throw on mere access */
  }
  function readJson(key) {
    try { const s = store(); const raw = s && s.getItem(key); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }             /* corrupted - start clean */
  }
  function writeJson(key, value) {
    try { const s = store(); if (s) s.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function removeKey(key) {
    try { const s = store(); if (s) s.removeItem(key); } catch (e) {}
  }

  const OVERLAY_FIELDS = ["collectedAt", "collectedByRole", "manual", "lidOverride", "muted",
                          "online", "device", "command", "commandAck", "updatedAt"];

  function cleanOverlay(o) {
    const out = {};
    if (!o || typeof o !== "object") return out;
    OVERLAY_FIELDS.forEach(function (k) { if (o[k] !== undefined) out[k] = o[k]; });
    return out;
  }

  /* ---- State --------------------------------------------------------- */
  OLD_KEYS.forEach(removeKey);

  function loadOverlays() {
    const raw = readJson(OVERLAY_KEY), out = {};
    if (raw && typeof raw === "object") {
      Object.keys(raw).forEach(function (id) {
        if (!SEED_BY_ID[id]) return;
        const ov = cleanOverlay(raw[id]);
        delete ov.device;                  /* device readings are never persisted (see applyLocalDevice) */
        out[id] = ov;
      });
    }
    return out;
  }

  function loadLog() {
    const raw = readJson(LOG_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (e) { return e && typeof e.t === "number" && typeof e.msg === "string"; })
              .slice(0, LOG_MAX);
  }

  let local       = loadOverlays();         /* this browser's overlays (the local backend) */
  let cloud       = {};                     /* overlays streamed in by FleetCloud          */
  let optimistic  = {};                     /* { id: { patch, at } } awaiting the cloud echo */
  let localDevice = {};                     /* direct-IP readings, this page only            */
  let cloudSeen   = false;
  let cloudEvents = [];
  let consumedCloudIds = {};                /* cloud events already matched to a local entry */
  let log         = loadLog();
  let logSeq      = 0;
  let fleet       = [];
  const listeners = [];

  function cloudLive() {
    try {
      return typeof FleetCloud !== "undefined" && !!FleetCloud &&
             typeof FleetCloud.status === "function" &&
             (FleetCloud.status() || {}).state === "live";
    } catch (e) { return false; }
  }

  /* Once the cloud has spoken, it stays the source for the rest of the
     session - a network blip should not flip the map back to local data. */
  function usingCloud() { return cloudSeen || cloudLive(); }

  function overlayFor(id, now) {
    let ov;
    if (usingCloud()) {
      ov = Object.assign({}, cloud[id] || {});
      const opt = optimistic[id];
      /* Keep a local change until its echo arrives - but if the cloud is
         live and has not confirmed it in 15 s, the write was lost or refused,
         and the cloud's version stands. */
      if (opt && (!cloudLive() || now - opt.at < OPTIMISTIC_MS)) Object.assign(ov, opt.patch);
    } else {
      ov = Object.assign({}, local[id] || {});
    }
    const d = localDevice[id];
    if (d && (!ov.device || ms(ov.device.reportedAt) <= d.reportedAt)) ov.device = d;
    return ov;
  }

  function save() {
    writeJson(OVERLAY_KEY, local);
  }

  function saveLog() {
    writeJson(LOG_KEY, log);
  }

  /* ---- Change notification (cloud snapshot, command, device reading) ---
     Coalesced into one call per burst: the first cloud snapshot delivers
     every bin at once and should repaint the page once, not 48 times.   */
  let notifyQueued = false;
  function notify() {
    if (notifyQueued) return;
    notifyQueued = true;
    const run = function () {
      notifyQueued = false;
      listeners.slice().forEach(function (fn) {
        try { fn(); } catch (e) { if (typeof console !== "undefined") console.error(e); }
      });
    };
    if (typeof Promise !== "undefined") Promise.resolve().then(run); else setTimeout(run, 0);
  }

  function onChange(fn) {
    if (typeof fn !== "function") return function () {};
    listeners.push(fn);
    return function () {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  /* ---- Activity log -------------------------------------------------- */
  function sessionLabel() {
    try {
      if (typeof AUTH !== "undefined" && AUTH && typeof AUTH.currentSession === "function") {
        const s = AUTH.currentSession();
        if (s && s.name) return String(s.name);
      }
    } catch (e) {}
    return "Dashboard";
  }

  function settle(p) {
    /* FleetCloud promises never reject by contract - this makes sure of it. */
    try {
      if (p && typeof p.then === "function") {
        return p.then(function (r) { return r || { ok: true }; },
                      function (e) { return { ok: false, error: e }; });
      }
      return Promise.resolve(p || { ok: false, error: "no-result" });
    } catch (e) { return Promise.resolve({ ok: false, error: e }); }
  }

  /* opts.cloud === true marks a human action worth sharing: when the cloud
     is live it is also written to the shared events log. The local copy is
     kept only until that event comes back (applyCloudEvents), so the feed
     shows it at once and never twice. */
  function addLog(binId, message, level, opts) {
    opts = opts || {};
    const entry = {
      id:     "local-" + Date.now() + "-" + (++logSeq),
      t:      Date.now(),
      binId:  String(binId).slice(0, 12),
      msg:    String(message).slice(0, 140),
      level:  level || "info",
      source: "local"
    };
    if (opts.by) entry.by = String(opts.by).slice(0, 60);

    const share = opts.cloud === true && cloudLive() && typeof FleetCloud.logEvent === "function";
    if (share) entry.shared = "pending";

    /* In the log BEFORE the cloud call, so an echo that comes back quickly
       always finds the local copy to replace. */
    log.unshift(entry);
    log = log.slice(0, LOG_MAX);
    saveLog();

    if (share) {
      const by = entry.by || sessionLabel().slice(0, 60);
      settle((function () {
        try { return FleetCloud.logEvent(entry.binId, entry.msg, entry.level, by); }
        catch (e) { return { ok: false, error: e }; }
      })()).then(function (res) {
        entry.shared = res && res.ok ? "sent" : false;   /* false: stays a local-only entry */
        saveLog();
      });
    }
    return entry;
  }

  function getLog() {
    const seen = {}, out = [];
    cloudEvents.forEach(function (e) {
      if (seen[e.id]) return;
      seen[e.id] = true;
      out.push(e);
    });
    log.forEach(function (e) { out.push(e); });
    return out.sort(function (a, b) { return b.t - a.t; });
  }

  function applyCloudEvents(list) {
    const now = Date.now();
    cloudEvents = (Array.isArray(list) ? list : []).filter(function (e) {
      return e && e.id && typeof e.msg === "string";
    }).map(function (e) {
      return {
        id: String(e.id), t: ms(e.t) || now,   /* a pending server timestamp has no time yet */
        binId: String(e.binId || ""), msg: e.msg, level: e.level || "info",
        by: e.by ? String(e.by) : "", source: "cloud"
      };
    });

    /* Retire local copies of shared actions whose cloud echo has arrived. */
    let changed = false;
    cloudEvents.forEach(function (c) {
      if (consumedCloudIds[c.id]) return;
      const i = log.findIndex(function (e) {
        return (e.shared === "pending" || e.shared === "sent") &&
               e.binId === c.binId && e.msg === c.msg &&
               (!e.by || !c.by || e.by === c.by) &&
               Math.abs(e.t - c.t) <= LOG_MATCH_MS;
      });
      if (i >= 0) { log.splice(i, 1); consumedCloudIds[c.id] = true; changed = true; }
    });
    if (changed) saveLog();
    notify();
  }

  /* ---- Recompute the fleet ---------------------------------------------
     emitFor: null = silently, "*" = every bin (tick), or one bin id.
     Status-change events are LOCAL only: every open tab computes the same
     change, so sharing them would write the same event once per tab.    */
  function statusEvent(bin, before, after) {
    if (after === "full")    return addLog(bin.id, "Bin is FULL - collection required", "error");
    if (after === "warning") return addLog(bin.id, "Crossed " + CONFIG.WARN_PERCENT + "% - schedule a pickup", "warn");
    if (after === "offline") return addLog(bin.id, "Device went offline - no telemetry", "error");
    if (after === "error")   return addLog(bin.id, "Sensor fault - level reading unavailable", "error");
    if (before === "offline" || before === "error") return addLog(bin.id, "Device back online", "success");
    if (bin.fill < 10)       return addLog(bin.id, "Emptied by the crew - bin back in service", "success");
    return addLog(bin.id, "Status returned to normal", "success");
  }

  function recompute(now, emitFor) {
    const prev = {};
    fleet.forEach(function (b) { prev[b.id] = b; });
    fleet = SEED.map(function (s) { return modelBin(s, overlayFor(s.id, now), now); });

    const events = [];
    if (emitFor) {
      fleet.forEach(function (b) {
        if (emitFor !== "*" && emitFor !== b.id) return;
        const was = prev[b.id];
        if (!was) return;
        const before = statusOf(was), after = statusOf(b);
        if (before !== after) events.push(statusEvent(b, before, after));
      });
    }
    return events;
  }

  /* Recompute at the current time; returns the status-change events. */
  function tick() {
    return recompute(Date.now(), "*");
  }

  /* ---- Commands: the dashboard equivalent of the serial commands -----
     Each returns the overlay change, the ACK text and the log level.     */
  const COMMANDS = {
    OPEN:   function (b) {
      return b.locked
        ? { patch: { manual: true, lidOverride: "OPEN" }, message: "Lid opened - crew override on a FULL bin", level: "warn" }
        : { patch: { manual: true, lidOverride: "OPEN" }, message: "Lid forced open" };
    },
    CLOSE:  function () { return { patch: { manual: true, lidOverride: "CLOSED" }, message: "Lid forced closed" }; },
    AUTO:   function (b) {
      return { patch: { manual: false, lidOverride: null },
               message: b.locked ? "Returned to automatic mode - bin FULL, lid locked"
                                 : "Returned to automatic mode" };
    },
    MUTE:   function () { return { patch: { muted: true },  message: "Buzzer muted" }; },
    UNMUTE: function () { return { patch: { muted: false }, message: "Buzzer enabled" }; },
    EMPTY:  function (b, now, actor) {
      return { patch: { collectedAt: now, collectedByRole: actor.role },
               message: b.locked ? "Marked as collected - lock released" : "Marked as collected",
               level: "success" };
    },
    PING:   function (b) {
      return { patch: { online: true },
               message: b.source === "device" ? "Ping sent - waiting for the device to report"
                                              : "Device responded" };
    }
  };

  /* The Firestore rules only accept these three roles in collectedByRole. */
  function normaliseActor(actor) {
    const a = actor || {};
    let role = String(a.role || "admin");
    if (role === "collector") role = "crew";
    if (role !== "owner" && role !== "admin" && role !== "crew") role = "admin";
    const label = a.label ? String(a.label).slice(0, 60) : (role === "crew" ? "Crew" : "Admin");
    return { role: role, label: label };
  }

  function sendCommand(binId, cmd, actor) {
    const seed = SEED_BY_ID[binId];
    if (!seed) return { ok: false, message: "Unknown bin " + binId, cloud: null };

    cmd = String(cmd || "").toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(COMMANDS, cmd)) {
      return { ok: false, message: "Unknown command " + cmd, cloud: null };
    }

    const who = normaliseActor(actor);
    const now = Date.now();
    const bin = modelBin(seed, overlayFor(binId, now), now);   /* fresh, not the last tick */

    if (!bin.online && cmd !== "PING") {
      addLog(binId, cmd + " failed - device offline", "error");
      return { ok: false, message: "Device is offline. Try PING first.", cloud: null };
    }

    const res = COMMANDS[cmd](bin, now, who);

    /* Apply locally at once, so the button visibly works. This browser's own
       copy always records it; in cloud mode it is also held as an optimistic
       patch until the next snapshot of this bin confirms or overwrites it. */
    local[binId] = Object.assign(local[binId] || {}, res.patch, { updatedAt: now });
    save();
    if (usingCloud()) {
      const prevPatch = optimistic[binId] ? optimistic[binId].patch : {};
      optimistic[binId] = { patch: Object.assign({}, prevPatch, res.patch, { updatedAt: now }), at: now };
    }
    recompute(now, null);

    let cloudResult = null;
    if (cloudLive() && typeof FleetCloud.writeCommand === "function") {
      cloudResult = settle((function () {
        try { return FleetCloud.writeCommand(binId, cmd, who); }
        catch (e) { return { ok: false, error: e }; }
      })());
    }

    addLog(binId, res.message, res.level || "info", { cloud: true, by: who.label });
    notify();
    return { ok: true, message: res.message, cloud: cloudResult };
  }

  /* Apply one command to every bin that passes a filter. */
  function sendBulk(cmd, filterFn, actor) {
    let count = 0;
    fleet.filter(filterFn || function () { return true; }).forEach(function (b) {
      if (sendCommand(b.id, cmd, actor).ok) count++;
    });
    return count;
  }

  /* ---- Inputs from FleetCloud ----------------------------------------- */
  function applyCloudOverlay(id, overlay) {
    if (!SEED_BY_ID[id]) return;
    const now   = Date.now();
    const first = !cloudSeen;
    cloudSeen = true;

    const prev = cloud[id];
    if (overlay) cloud[id] = cleanOverlay(overlay);
    else delete cloud[id];                  /* doc deleted: back to the plain model */

    /* The snapshot confirms or overwrites the optimistic change - except a
       field the cloud has not filled in yet (a pending server timestamp
       arrives as null for a moment), which would otherwise flicker. */
    const opt = optimistic[id];
    if (opt) {
      const keep = {};
      let any = false;
      Object.keys(opt.patch).forEach(function (k) {
        if (k !== "updatedAt" && (!overlay || overlay[k] == null) && opt.patch[k] != null) {
          keep[k] = opt.patch[k]; any = true;
        }
      });
      if (any && now - opt.at < OPTIMISTIC_MS) optimistic[id] = { patch: keep, at: opt.at };
      else delete optimistic[id];
    }

    /* A fresh report from a real device is news worth a local event; the
       first snapshot (switching from local to cloud data) is not. */
    const fresh = !first && overlay && overlay.device && prev && prev.device &&
                  ms(prev.device.reportedAt) !== ms(overlay.device.reportedAt);
    recompute(now, fresh ? id : null);
    notify();
  }

  /* A reading polled straight from a board's /api/status on the same Wi-Fi.
     It is this page's alone: not written to the cloud, and not saved - after
     a reload the bin returns to the model instead of showing a stale link. */
  function normaliseDevice(r, reportedAt) {
    const status = typeof r.status === "string" ? r.status : "";
    const d = {
      fill:     numOr(r.fill, 0),
      fillA:    numOr(r.fillA, null),
      fillB:    numOr(r.fillB, null),
      lid:      typeof r.lid === "string" ? r.lid : "CLOSED",
      status:   status,
      locked:   typeof r.locked === "boolean" ? r.locked : status === "FULL",  /* older firmware */
      opens:    intOr(r.opens, 0),
      refused:  intOr(r.refused, 0),
      errors:   intOr(r.errors, 0),
      sensors:  intOr(r.sensors, null),
      rssi:     intOr(r.rssi, null),
      firmware: typeof r.firmware === "string" ? r.firmware.slice(0, 20) : "",
      reportedAt: reportedAt
    };
    if (typeof r.muted  === "boolean") d.muted  = r.muted;
    if (typeof r.manual === "boolean") d.manual = r.manual;
    return d;
  }

  function applyLocalDevice(id, reading) {
    if (!SEED_BY_ID[id] || !reading || typeof reading !== "object") return false;
    const now = Date.now();
    const had = !!localDevice[id];
    localDevice[id] = normaliseDevice(reading, now);
    recompute(now, had ? id : null);        /* the first reading is a switch-over, not news */
    notify();
    return true;
  }

  function dataSource() { return usingCloud() ? "cloud" : "local"; }

  /* Clear this browser's overrides and log. The cloud is not touched. */
  function reset() {
    local = {};
    optimistic = {};
    localDevice = {};
    log = [];
    removeKey(OVERLAY_KEY);
    removeKey(LOG_KEY);
    recompute(Date.now(), null);
    notify();
    return fleet;
  }

  function summary() {
    const s = { total: fleet.length, ok:0, warning:0, full:0, offline:0, error:0, locked:0,
                avgFill:0, totalOpens:0 };
    let sum = 0, n = 0;
    fleet.forEach(function (b) {
      const st = statusOf(b);
      s[st]++;
      if (b.locked) s.locked++;
      s.totalOpens += b.opens || 0;
      if (st !== "offline" && st !== "error") { sum += b.fill; n++; }   /* only readings we trust */
    });
    s.avgFill = n ? Math.round(sum / n) : 0;
    return s;
  }

  recompute(Date.now(), null);

  /* ---- Public API ---------------------------------------------------- */
  return {
    CONFIG:          CONFIG,
    SEED:            SEED,
    EPOCH:           EPOCH,
    RATE_PER_HOUR:   RATE_PER_HOUR,
    FULL_GRACE_H:    FULL_GRACE_H,
    hash32:          hash32,
    rand01:          rand01,
    modelBin:        modelBin,
    getFleet:        function () { return fleet; },
    getBin:          function (id) { return fleet.find(function (b) { return b.id === id; }); },
    getZones:        function () { return [...new Set(SEED.map(function (b) { return b.zone; }))].sort(); },
    summary:         summary,
    statusOf:        statusOf,
    statusLabel:     statusLabel,
    fillToDistance:  fillToDistance,
    distanceToFill:  distanceToFill,
    sendCommand:     sendCommand,
    sendBulk:        sendBulk,
    addLog:          addLog,
    getLog:          getLog,
    tick:            tick,
    applyCloudOverlay: applyCloudOverlay,
    applyCloudEvents:  applyCloudEvents,
    applyLocalDevice:  applyLocalDevice,
    onChange:        onChange,
    dataSource:      dataSource,
    save:            save,
    reset:           reset
  };
})();

/* ---- Small formatting helpers shared by every page -------------------- */
function timeAgo(ts) {
  /* max(0): a server timestamp can be a second ahead of this PC's clock */
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
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

/* Node (tests) - in the browser `module` does not exist. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { SD: SD, timeAgo: timeAgo, clockTime: clockTime, escapeHtml: escapeHtml };
}

/* Node test for the fleet model - run with:  node tests/fleet.test.js
   The website's bins are a pure function of the clock (website/assets/js/data.js),
   so every browser shows the same fleet. These checks pin that model down:
   determinism, bounded fill cycles, the full-bin LOCKDOWN, commands, device-linked
   bins, local persistence and the cloud hand-off - plus the server's copy of the
   seed and its command rules. No browser, no network, no packages. */
const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "../website/assets/js/data.js");
const HOUR = 3600e3;
const E0 = Date.UTC(2026, 8, 22, 0, 0, 0);

/* A controllable clock: data.js asks Date.now() whenever it needs "now". */
let NOW = E0;
Date.now = function () { return NOW; };

/* A fresh copy of data.js, as if the page had just been loaded. */
function loadSD() {
  delete require.cache[require.resolve(DATA)];
  return require(DATA).SD;
}

function memoryStorage(initial) {
  const m = Object.assign({}, initial || {});
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    dump: () => m
  };
}

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? "  PASS  " : "  FAIL  ") + name +
              (ok ? "" : "   expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)));
  ok ? pass++ : fail++;
}
const tick = () => new Promise(r => setImmediate(r));

(async function main() {
  delete global.localStorage;
  delete global.FleetCloud;
  let SD = loadSD();
  const E = SD.EPOCH;

  /* ---------- 1. the seed ---------- */
  console.log("\nSeed fleet");
  check("EPOCH is 2026-09-22 00:00 UTC", E, E0);
  check("48 bins", SD.SEED.length, 48);
  check("48 unique ids", new Set(SD.SEED.map(s => s.id)).size, 48);
  check("ids run BIN-001 .. BIN-048 in order",
        SD.SEED.every((s, i) => s.id === "BIN-" + String(i + 1).padStart(3, "0")), true);
  check("every bin is inside greater Hyderabad (lat 17.2-17.7, lng 78.25-78.7)",
        SD.SEED.filter(s => !(s.lat > 17.2 && s.lat < 17.7 && s.lng > 78.25 && s.lng < 78.7)).map(s => s.id), []);
  check("every seed fill is 0-95", SD.SEED.every(s => s.fill >= 0 && s.fill <= 95), true);
  check("every category has its own fill rate",
        SD.SEED.filter(s => !SD.RATE_PER_HOUR[s.category]).map(s => s.id), []);
  check("two dead devices: BIN-012 and BIN-038",
        SD.SEED.filter(s => s.offline).map(s => s.id), ["BIN-012", "BIN-038"]);
  check("BIN-038 is Shamshabad Town Centre", SD.SEED[37].name, "Shamshabad Town Centre");

  /* The original sixteen must not move - people have seen them on the map. */
  const ORIGINAL = [
    ["BIN-001","Charminar Plaza",17.3616,78.4747,34,120], ["BIN-002","Secunderabad Station P1",17.4340,78.5013,92,240],
    ["BIN-003","RGIA Terminal 2 Arrivals",17.2403,78.4294,61,240], ["BIN-004","Gandhi Hospital Ward B",17.4399,78.4983,78,80],
    ["BIN-005","Inorbit Mall Food Court",17.4345,78.3866,88,180], ["BIN-006","HITEC City Metro Gate 2",17.4483,78.3915,45,120],
    ["BIN-007","MRCET Campus Block A",17.5560,78.4483,22,80], ["BIN-008","Tank Bund Walkway",17.4239,78.4738,67,120],
    ["BIN-009","Necklace Road Park",17.4180,78.4670,15,120], ["BIN-010","Begumpet Office Park",17.4435,78.4645,53,80],
    ["BIN-011","KPHB Market Lane 4",17.4849,78.3915,95,180], ["BIN-012","Gachibowli Stadium G3",17.4239,78.3448,8,240],
    ["BIN-013","Osmania Univ Library",17.4065,78.5265,41,80], ["BIN-014","Uppal Industrial Estate",17.4055,78.5600,72,240],
    ["BIN-015","Kukatpally Bus Depot",17.4948,78.3996,80,180], ["BIN-016","Golconda Fort Entrance",17.3833,78.4011,29,120]
  ];
  check("BIN-001..016 unchanged (name, coordinates, fill, capacity)",
        SD.SEED.slice(0, 16).map(s => [s.id, s.name, s.lat, s.lng, s.fill, s.capacity]), ORIGINAL);

  const seedFile = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/bins.json"), "utf8"));
  check("data/bins.json has the same 48 bins as SEED (id, coords, fill, capacity, online)",
        seedFile.bins.map(b => [b.id, b.lat, b.lng, b.fill, b.capacity, b.online]),
        SD.SEED.map(s => [s.id, s.lat, s.lng, s.fill, s.capacity, !s.offline]));

  check("FNV-1a of the empty string", SD.hash32(""), 2166136261);
  check("FNV-1a of \"a\"", SD.hash32("a"), 0xe40c292c);
  check("rand01 stays in [0, 1)", [..."abcdefghij"].every(c => { const r = SD.rand01(c); return r >= 0 && r < 1; }), true);
  check("CONFIG: FULL 90, WARN 75, device stale after 2 min",
        [SD.CONFIG.FULL_PERCENT, SD.CONFIG.WARN_PERCENT, SD.CONFIG.DEVICE_STALE_MIN], [90, 75, 2]);

  /* ---------- 2. determinism ---------- */
  console.log("\nDeterminism - every browser computes the same fleet");
  const t1 = E + 13.37 * HOUR;
  const a = SD.SEED.map(s => SD.modelBin(s, null, t1));
  NOW = E + 99 * HOUR;                                  /* the wall clock must not matter */
  const b = SD.SEED.map(s => SD.modelBin(s, null, t1));
  check("modelBin is pure: same (seed, overlay, now) -> same record", a, b);
  NOW = t1;
  const other = loadSD();
  const mine = loadSD();
  check("two freshly loaded pages agree bin for bin", other.getFleet(), mine.getFleet());
  check("every bin reads exactly its seed fill at EPOCH",
        SD.SEED.filter(s => SD.modelBin(s, null, E).fill !== s.fill).map(s => s.id), []);

  const mix = { ok: 0, warning: 0, full: 0, offline: 0, error: 0 };
  SD.SEED.forEach(s => mix[SD.statusOf(SD.modelBin(s, null, E))]++);
  check("status mix at EPOCH (25 normal, 12 near full, 9 full, 2 offline)",
        mix, { ok: 25, warning: 12, full: 9, offline: 2, error: 0 });
  check("roughly 55 / 25 / 20 % (normal / near full / full)",
        mix.ok / 48 > 0.48 && mix.ok / 48 < 0.6 && mix.warning / 48 > 0.2 && mix.warning / 48 < 0.3 &&
        mix.full / 48 > 0.15 && mix.full / 48 < 0.25, true);

  /* ---------- 3. a week of simulated time ---------- */
  console.log("\nA 7-day sweep");
  const STEP = 10 * 60e3;
  const samples = {};                                   /* id -> [fill every 10 min for 8 days] */
  let outOfRange = [], lockMismatch = [], lockedOpen = 0, frozenMoved = [];
  SD.SEED.forEach(s => {
    samples[s.id] = [];
    const first = SD.modelBin(s, null, E);
    for (let t = E; t <= E + 8 * 24 * HOUR; t += STEP) {
      const bin = SD.modelBin(s, null, t);
      samples[s.id].push(bin.fill);
      if (!(bin.fill >= 0 && bin.fill <= 100)) outOfRange.push(s.id);
      if (bin.locked !== (bin.online && bin.fill >= 90)) lockMismatch.push(s.id);
      if (bin.locked && bin.lid === "OPEN") lockedOpen++;
      if (s.offline && (bin.fill !== first.fill || bin.lastSeen !== E - 4 * HOUR)) frozenMoved.push(s.id);
    }
  });
  check("every fill stays within 0-100 %", [...new Set(outOfRange)], []);
  check("locked == online and fill >= 90, always", [...new Set(lockMismatch)], []);
  check("no locked bin shows lid OPEN (no operator override)", lockedOpen, 0);
  check("a dead device stays frozen at its last reading", [...new Set(frozenMoved)], []);

  /* Bounded cycles: a simulated crew empties every bin, so no online bin
     can sit at or above 90 % for a whole day. */
  const perDay = 24 * HOUR / STEP;
  const stuck = [];
  SD.SEED.filter(s => !s.offline).forEach(s => {
    const f = samples[s.id];
    for (let w = 0; w + perDay < f.length; w += 6) {
      if (!f.slice(w, w + perDay + 1).some(v => v < 90)) { stuck.push(s.id); break; }
    }
  });
  check("every online bin drops below 90 % in any 24 h window", stuck, []);
  check("every online bin reaches FULL at some point in the week",
        SD.SEED.filter(s => !s.offline && !samples[s.id].some(v => v >= 90)).map(s => s.id), []);

  /* Lid animation: ~12 % of 4-second slots, identical on every screen. */
  const unlocked = SD.SEED[0];
  let open = 0, slots = 5000;
  for (let i = 0; i < slots; i++) {
    const t = E + i * 4000;
    const bin = SD.modelBin(unlocked, null, t);
    if (!bin.locked && bin.lid === "OPEN") open++;
  }
  check("an unlocked bin's lid opens in roughly 12 % of 4 s slots", open / slots > 0.08 && open / slots < 0.16, true);

  /* ---------- 4. LOCKDOWN ---------- */
  console.log("\nFull-bin lockdown");
  const full = SD.SEED[1];                              /* BIN-002, 92 % at EPOCH */
  let lockedSlots = 0, openWhileLocked = 0;
  for (let i = 0; i < 2000; i++) {
    const bin = SD.modelBin(full, null, E + i * 4000);
    if (bin.locked) { lockedSlots++; if (bin.lid === "OPEN") openWhileLocked++; }
  }
  check("BIN-002 is locked for many consecutive 4 s slots", lockedSlots > 300, true);
  check("...and its lid never opens by itself while locked", openWhileLocked, 0);
  const forced = SD.modelBin(full, { manual: true, lidOverride: "OPEN" }, E);
  check("an operator OPEN shows the lid OPEN on a locked bin", forced.lid, "OPEN");
  check("...while the bin stays locked against hands", forced.locked, true);
  check("an operator CLOSE shows it CLOSED",
        SD.modelBin(full, { manual: true, lidOverride: "CLOSED" }, E).lid, "CLOSED");

  NOW = E;
  SD = loadSD();
  const r1 = SD.sendCommand("BIN-002", "OPEN");
  check("OPEN on a locked bin succeeds", r1.ok, true);
  check("...with the crew-override message", r1.message, "Lid opened - crew override on a FULL bin");
  check("...and cloud is null when no cloud is connected", r1.cloud, null);
  check("the fleet shows it at once: lid OPEN, still locked",
        [SD.getBin("BIN-002").lid, SD.getBin("BIN-002").locked], ["OPEN", true]);
  check("OPEN on an unlocked bin is a plain forced open", SD.sendCommand("BIN-001", "OPEN").message, "Lid forced open");
  SD.sendCommand("BIN-002", "AUTO");
  check("AUTO on a still-full bin: the lid locks shut again", SD.getBin("BIN-002").lid, "CLOSED");

  const re = SD.sendCommand("BIN-002", "EMPTY");
  check("EMPTY succeeds and says the lock is released", [re.ok, re.message], [true, "Marked as collected - lock released"]);
  const emptied = SD.getBin("BIN-002");
  check("EMPTY resets the fill to <= 4 % at the same instant", emptied.fill <= 4, true);
  check("EMPTY releases the lock and the turned-away count", [emptied.locked, emptied.refused], [false, 0]);
  check("EMPTY records who collected it (default actor = admin)", emptied.collectedByRole, "admin");
  NOW = E + HOUR;
  SD.tick();
  check("an emptied bin starts filling again", SD.getBin("BIN-002").fill > emptied.fill + 10, true);
  NOW = E;
  SD.sendCommand("BIN-011", "EMPTY", { role: "collector", label: "Crew - Ravi" });
  check("a collector's EMPTY is recorded as role crew", SD.getBin("BIN-011").collectedByRole, "crew");
  /* Not getLog()[0]: the clock was just wound BACK an hour, and the log is
     sorted newest-first by timestamp, so the tick's events still sit on top.
     Look the entry up instead of assuming where it landed. */
  check("the log entry names who did it",
        SD.getLog().filter(e => e.binId === "BIN-011")[0].by, "Crew - Ravi");

  const resetAll = SD.SEED.filter(s => !s.offline).filter(s =>
    [3, 29, 100.5, 170].some(h => SD.modelBin(s, { collectedAt: E + h * HOUR }, E + h * HOUR).fill > 4));
  check("EMPTY resets every bin to <= 4 % at any instant", resetAll.map(s => s.id), []);

  /* ---------- 5. offline devices ---------- */
  console.log("\nOffline devices");
  SD = loadSD();
  const refusedCmds = ["OPEN", "CLOSE", "AUTO", "MUTE", "UNMUTE", "EMPTY"].filter(c => SD.sendCommand("BIN-012", c).ok);
  check("an offline bin refuses every command except PING", refusedCmds, []);
  check("...with the documented message", SD.sendCommand("BIN-038", "EMPTY").message, "Device is offline. Try PING first.");
  const ping = SD.sendCommand("BIN-012", "PING");
  check("PING succeeds on an offline bin", [ping.ok, ping.message], [true, "Device responded"]);
  check("PING revives an offline model bin", [SD.getBin("BIN-012").online, SD.statusOf(SD.getBin("BIN-012"))][0], true);
  check("a revived bin takes commands again", SD.sendCommand("BIN-012", "MUTE").ok, true);
  check("an unknown command is refused", SD.sendCommand("BIN-001", "SELFDESTRUCT").ok, false);
  check("\"constructor\" is not a command", SD.sendCommand("BIN-001", "constructor").ok, false);
  check("an unknown bin is refused", SD.sendCommand("BIN-999", "PING").ok, false);
  NOW = E;
  SD = loadSD();
  check("sendBulk MUTE on full bins mutes all 9", SD.sendBulk("MUTE", b => SD.statusOf(b) === "full"), 9);
  check("summary() counts locked and error bins",
        (({ total, full, offline, error, locked }) => ({ total, full, offline, error, locked }))(SD.summary()),
        { total: 48, full: 9, offline: 2, error: 0, locked: 9 });

  /* ---------- 6. device-linked bins ---------- */
  console.log("\nDevice-linked bins (a real ESP32 reporting through the cloud)");
  const s5 = SD.SEED[4];
  const T = E + 5 * HOUR;
  const dev = (extra) => ({ device: Object.assign({ fill: 72, fillA: 70, fillB: 74, lid: "OPEN", status: "OK",
                                                    locked: false, opens: 12, refused: 0, reportedAt: T - 30e3 }, extra) });
  const d1 = SD.modelBin(s5, dev(), T);
  check("the device's readings replace the model",
        [d1.source, d1.fill, d1.fillA, d1.fillB, d1.lid, d1.opens], ["device", 72, 70, 74, "OPEN", 12]);
  check("lastSeen is the device's report time", d1.lastSeen, T - 30e3);
  const d2 = SD.modelBin(s5, dev({ fill: 95, status: "FULL", locked: true, lid: "CLOSED", refused: 3 }), T);
  check("a FULL device is locked and counts refusals", [d2.locked, d2.refused, SD.statusOf(d2)], [true, 3, "full"]);
  check("silent for exactly 2 min: still online", SD.modelBin(s5, dev({ reportedAt: T - 120e3 }), T).online, true);
  const stale = SD.modelBin(s5, dev({ reportedAt: T - 121e3, locked: true, fill: 95 }), T);
  check("silent for longer than DEVICE_STALE_MIN: offline, not locked",
        [stale.online, stale.locked, SD.statusOf(stale)], [false, false, "offline"]);
  check("SENSOR_ERROR -> status \"error\"",
        SD.statusOf(SD.modelBin(s5, dev({ status: "SENSOR_ERROR", fill: -1 }), T)), "error");
  check("\"error\" is labelled Sensor fault", SD.statusLabel("error"), "Sensor fault");
  const pend = Object.assign(dev({ lid: "CLOSED", reportedAt: T - 10e3 }), { manual: true, lidOverride: "OPEN", updatedAt: T - 5e3 });
  check("a dashboard OPEN not yet reported by the board is shown at once", SD.modelBin(s5, pend, T).lid, "OPEN");
  pend.device.reportedAt = T - 1e3;
  check("...and the board's own report wins once it arrives", SD.modelBin(s5, pend, T).lid, "CLOSED");
  const pe = Object.assign(dev({ fill: 96, locked: true, status: "FULL", reportedAt: T - 20e3 }), { collectedAt: T - 3e3 });
  const pb = SD.modelBin(s5, pe, T);
  check("an EMPTY after the last report shows 0 % and unlocked", [pb.fill, pb.locked], [0, false]);

  NOW = T;
  SD = loadSD();
  check("applyLocalDevice links a bin", SD.applyLocalDevice("BIN-005", { id: "BIN-005", fill: 93, fillA: 92, fillB: 94,
        lid: "CLOSED", status: "FULL", opens: 40, errors: 0, sensors: 2, rssi: -60, firmware: "2.1.0" }), true);
  const l1 = SD.getBin("BIN-005");
  check("older firmware without \"locked\": FULL implies locked", [l1.source, l1.fill, l1.locked, l1.firmware],
        ["device", 93, true, "2.1.0"]);
  SD.applyLocalDevice("BIN-006", { fill: 40, status: "SENSOR_ERROR", lid: "CLOSED" });
  check("a sensor fault is counted in summary().error", SD.summary().error, 1);
  NOW = T + 3 * 60e3;
  const staleEvents = SD.tick();
  check("the board goes quiet: shown offline after 2 min", SD.getBin("BIN-005").online, false);
  check("...and tick() reports it", staleEvents.some(e => e.binId === "BIN-005" && /offline/.test(e.msg)), true);
  check("a direct-IP reading is not saved (a reload returns the model)", loadSD().getBin("BIN-005").source, "model");

  /* ---------- 7. tick events ---------- */
  console.log("\nStatus-change events");
  NOW = E;
  SD = loadSD();
  let events = [];
  for (let m = 1; m <= 180 && !events.length; m++) { NOW = E + m * 60e3; events = SD.tick(); }
  check("time passing produces status-change events", events.length > 0, true);
  check("events carry a level the log understands",
        events.every(e => ["info", "success", "warn", "error"].indexOf(e.level) >= 0), true);
  check("tick() with no time passing produces none", SD.tick(), []);

  /* ---------- 8. local persistence ---------- */
  console.log("\nLocal persistence");
  global.localStorage = memoryStorage({ "smartdustbin.fleet.v1": "[]", "smartdustbin.log.v1": "[]" });
  NOW = E;
  SD = loadSD();
  check("the old v1 keys are removed on load",
        ["smartdustbin.fleet.v1", "smartdustbin.log.v1"].filter(k => localStorage.getItem(k) !== null), []);
  SD.sendCommand("BIN-003", "MUTE");
  check("an overlay is saved under smartdustbin.overlay.v2",
        JSON.parse(localStorage.getItem("smartdustbin.overlay.v2"))["BIN-003"].muted, true);
  check("it survives a reload", loadSD().getBin("BIN-003").muted, true);
  for (let i = 0; i < 80; i++) SD.addLog("BIN-001", "entry " + i, "info");
  check("the local log keeps at most 60 entries", JSON.parse(localStorage.getItem("smartdustbin.log.v2")).length, 60);
  check("getLog is newest first", SD.getLog()[0].msg, "entry 79");
  SD.reset();
  check("reset() clears overlays and the log",
        [localStorage.getItem("smartdustbin.overlay.v2"), SD.getLog().length, SD.getBin("BIN-003").muted], [null, 0, false]);
  delete global.localStorage;
  Object.defineProperty(global, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
  let survived = false;
  try { const S = loadSD(); survived = S.sendCommand("BIN-001", "MUTE").ok && S.getLog().length === 1; } catch (e) {}
  check("storage that throws on access (private mode) is survived", survived, true);
  delete global.localStorage;

  /* ---------- 9. the cloud hand-off (FleetCloud stub) ---------- */
  console.log("\nCloud hand-off");
  const calls = { write: [], log: [] };
  let writeResult = { ok: true };
  global.FleetCloud = {
    status: () => ({ state: "live" }),
    writeCommand: (id, cmd, actor) => { calls.write.push([id, cmd, actor]); return Promise.resolve(writeResult); },
    logEvent: (id, msg, level, by) => { calls.log.push([id, msg, level, by]); return Promise.resolve({ ok: true }); }
  };
  NOW = E;
  SD = loadSD();
  check("dataSource() is cloud while FleetCloud is live", SD.dataSource(), "cloud");
  const rc = SD.sendCommand("BIN-002", "EMPTY", { role: "owner", label: "Nischay" });
  check("sendCommand hands the command to FleetCloud.writeCommand",
        calls.write, [["BIN-002", "EMPTY", { role: "owner", label: "Nischay" }]]);
  check("...returns its promise as .cloud", !!(rc.cloud && typeof rc.cloud.then === "function"), true);
  check("...which resolves {ok:true}", await rc.cloud, { ok: true });
  check("the action is written to the shared log with the actor's name",
        calls.log, [["BIN-002", "Marked as collected - lock released", "success", "Nischay"]]);
  check("the change shows at once (optimistic), before any snapshot", SD.getBin("BIN-002").fill <= 4, true);
  SD.applyCloudEvents([{ id: "ev1", t: E + 800, binId: "BIN-002", msg: "Marked as collected - lock released",
                         level: "success", by: "Nischay" },
                       { id: "ev1", t: E + 800, binId: "BIN-002", msg: "Marked as collected - lock released",
                         level: "success", by: "Nischay" }]);
  const shared = SD.getLog().filter(e => e.msg === "Marked as collected - lock released");
  check("the action appears once in the log after its cloud echo (de-duplicated)", shared.length, 1);
  check("...and it is the cloud copy, with id and name", [shared[0].id, shared[0].by], ["ev1", "Nischay"]);
  check("tick() status events never go to the cloud", (() => {
    const before = calls.log.length; for (let m = 1; m <= 120; m++) { NOW = E + m * 60e3; SD.tick(); }
    return calls.log.length - before;
  })(), 0);

  NOW = E;
  SD = loadSD();
  let fired = 0;
  const off = SD.onChange(() => fired++);
  SD.applyCloudOverlay("BIN-004", { muted: true, updatedAt: E - 1000 });
  SD.applyCloudOverlay("BIN-005", { manual: true, lidOverride: "OPEN", updatedAt: E - 1000 });
  SD.applyCloudOverlay("BIN-777", { muted: true });
  await tick();
  check("a burst of cloud snapshots notifies listeners once", fired, 1);
  check("cloud overlays drive the fleet", [SD.getBin("BIN-004").muted, SD.getBin("BIN-005").lid], [true, "OPEN"]);
  check("an unknown bin id from the cloud is ignored", SD.getFleet().length, 48);
  off();
  SD.applyCloudOverlay("BIN-004", null);
  await tick();
  check("unsubscribe works, and a deleted doc returns the bin to the model",
        [fired, SD.getBin("BIN-004").muted], [1, false]);
  SD.applyCloudOverlay("BIN-009", { collectedAt: E - 10 * 60e3, collectedByRole: "crew" });
  check("a collection made on another screen resets this one", SD.getBin("BIN-009").collectedByRole, "crew");

  writeResult = { ok: false, error: "permission-denied" };
  check("a refused cloud write resolves {ok:false} for the caller to explain",
        await SD.sendCommand("BIN-001", "MUTE").cloud, { ok: false, error: "permission-denied" });
  global.FleetCloud.writeCommand = () => { throw new Error("boom"); };
  const thrown = SD.sendCommand("BIN-001", "UNMUTE");
  check("a FleetCloud that throws never breaks the command", [thrown.ok, (await thrown.cloud).ok], [true, false]);
  global.FleetCloud.status = () => ({ state: "connecting" });
  check("while the cloud is not live, .cloud is null", SD.sendCommand("BIN-001", "MUTE").cloud, null);
  delete global.FleetCloud;

  /* ---------- 10. the local server's copy ---------- */
  console.log("\nserver/server.js (zero-dependency backend)");
  const srv = require("../server/server.js");
  const sfleet = srv.loadFleet();
  check("the server seeds the same 48 bins", sfleet.length, 48);
  check("GET /api/bins adds a \"locked\" flag to each bin", sfleet.map(srv.withDerived).every(x => typeof x.locked === "boolean"), true);
  const sb = JSON.parse(JSON.stringify(sfleet.find(x => x.id === "BIN-002")));
  check("a 92 % server bin is locked", srv.isLocked(sb), true);
  check("server OPEN on a locked bin is the crew override", srv.COMMANDS.OPEN(sb), "Lid opened - crew override on a FULL bin");
  check("server AUTO on a full bin shuts the lid", [srv.COMMANDS.AUTO(sb), sb.lid], ["Automatic mode - bin FULL, lid locked", "CLOSED"]);
  check("server EMPTY releases the lock", [srv.COMMANDS.EMPTY(sb), srv.isLocked(sb), sb.refused],
        ["Marked as collected - lock released", false, 0]);

  console.log("\n----------------------------------------");
  console.log("  " + pass + " passed, " + fail + " failed");
  console.log("----------------------------------------\n");
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});

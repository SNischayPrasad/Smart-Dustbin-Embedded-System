/* ==========================================================================
   Tests for fleet-cloud.js - the browser half of the shared fleet.
   Run:  node tests/cloud.test.js

   Firestore itself is stubbed (the same approach as tests/store.test.js), so
   these run in a second with no emulator and no network. What they check is
   the code this project actually wrote: which overlay fields each command
   maps to, that Firestore Timestamps become the epoch milliseconds data.js
   expects, that a deleted document is passed on as a removal, and that a
   failure anywhere becomes { ok:false } rather than an exception.

   The rules themselves - who is allowed to do any of this - are tested for
   real against the emulator in tests/rules/.
   ========================================================================== */

const fs   = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (!ok && detail ? "  <- " + detail : ""));
  ok ? pass++ : fail++;
}

/* ---- a Firestore stub with just enough behaviour ----------------------
   Notably it records what was WRITTEN, because the field mapping is the
   part of this file most likely to be wrong in a way nothing else notices. */
const SENTINEL = { __serverTimestamp: true };

function makeTimestamp(ms) {
  return { toMillis: function () { return ms; } };
}

const cloud = {
  binsListener:   null,
  binsError:      null,
  eventsListener: null,
  eventsError:    null,
  eventsQuery:    null,
  writes:         [],          /* { id, data, merge } */
  added:          [],          /* documents appended to `events` */
  denyWrites:     false,
  throwOnSet:     false,
  unsubscribed:   { bins: 0, events: 0 }
};

function resetCloud() {
  cloud.binsListener = null; cloud.binsError = null;
  cloud.eventsListener = null; cloud.eventsError = null; cloud.eventsQuery = null;
  cloud.writes = []; cloud.added = [];
  cloud.denyWrites = false; cloud.throwOnSet = false;
  cloud.unsubscribed = { bins: 0, events: 0 };
}

function denied() {
  const e = new Error("Missing or insufficient permissions.");
  e.code = "permission-denied";
  return e;
}

function eventsCollection() {
  const q = { order: null, max: null };
  const api = {
    orderBy: function (f, dir) { q.order = f + " " + dir; return api; },
    limit:   function (n) { q.max = n; return api; },
    onSnapshot: function (next, err) {
      cloud.eventsListener = next; cloud.eventsError = err; cloud.eventsQuery = q;
      return function () { cloud.unsubscribed.events++; };
    },
    add: function (data) {
      if (cloud.denyWrites) return Promise.reject(denied());
      cloud.added.push(data);
      return Promise.resolve({ id: "evt-" + cloud.added.length });
    }
  };
  return api;
}

function binsCollection() {
  return {
    onSnapshot: function (next, err) {
      cloud.binsListener = next; cloud.binsError = err;
      return function () { cloud.unsubscribed.bins++; };
    },
    doc: function (id) {
      return {
        set: function (data, opts) {
          if (cloud.throwOnSet) throw new Error("synchronous explosion");
          if (cloud.denyWrites) return Promise.reject(denied());
          cloud.writes.push({ id: id, data: data, merge: !!(opts && opts.merge) });
          return Promise.resolve();
        }
      };
    }
  };
}

let authUser = null;
let authCb   = null;

function installFirebase(opts) {
  opts = opts || {};
  const fb = {
    apps: [],
    initializeApp: function () { fb.apps.push({}); },
    firestore: Object.assign(function () {
      return {
        collection: function (name) {
          return name === "events" ? eventsCollection() : binsCollection();
        }
      };
    }, {
      FieldValue: { serverTimestamp: function () { return SENTINEL; } }
    })
  };
  /* index.html loads no auth SDK at all, so this half must be optional. */
  if (opts.auth !== false) {
    fb.auth = function () {
      return {
        get currentUser() { return authUser; },
        /* Real Firebase calls the callback once on registration, with the
           restored session or null. Code that only reacted to a LATER change
           would never subscribe on a page reload, so the stub does it too. */
        onAuthStateChanged: function (cb) {
          authCb = cb;
          cb(authUser);
          return function () { authCb = null; };
        }
      };
    };
  }
  global.firebase = fb;
}

/* ---- the code under test, reloaded per scenario ----------------------- */
const SRC = fs.readFileSync(path.join(__dirname, "../website/assets/js/fleet-cloud.js"), "utf8");

/* What data.js was handed, so the conversion can be inspected. */
const delivered = { overlays: [], events: null };

function loadFleetCloud() {
  delivered.overlays = [];
  delivered.events = null;
  global.SD = {
    applyCloudOverlay: function (id, overlay) { delivered.overlays.push({ id: id, overlay: overlay }); },
    applyCloudEvents:  function (list) { delivered.events = list; }
  };
  /* A fresh IIFE each time: start() is deliberately one-shot, so a scenario
     that needs a clean slate needs a clean module. */
  const sandbox = { FleetCloud: null };
  eval(SRC.replace("const FleetCloud", "var FleetCloud") +
       "\nsandbox.FleetCloud = FleetCloud;");
  return sandbox.FleetCloud;
}

global.FIREBASE_CONFIG = {
  FIREBASE: { apiKey: "AIzaFake", projectId: "demo-sdbs" },
  OWNER_UIDS: ["owner-uid"],
  COLLECTION: "admins",
  COLLECTOR_EMAIL: "crew@example.com",
  COLLECTOR_UIDS: [],
  DEVICE_BINS: {}
};

/* Deliver a snapshot to the bins listener. */
function snapshot(changes, size) {
  cloud.binsListener({
    size: typeof size === "number" ? size : changes.length,
    docChanges: function () {
      return changes.map(function (c) {
        return {
          type: c.type || "added",
          doc: { id: c.id, data: function () { return c.data; } }
        };
      });
    }
  });
}

function lastWrite() { return cloud.writes[cloud.writes.length - 1]; }

(async function () {

  /* ====================================================================== */
  console.log("\nConfiguration gate");
  resetCloud();
  installFirebase();
  let FC = loadFleetCloud();
  check("apiKey + projectId means configured", FC.configured() === true);

  const realCfg = global.FIREBASE_CONFIG;
  global.FIREBASE_CONFIG = { FIREBASE: { apiKey: "", projectId: "" } };
  FC = loadFleetCloud();
  check("an empty apiKey is not configured", FC.configured() === false);
  check("start() refuses and stays off", FC.start() === false && FC.status().state === "off");
  check("writeCommand before start resolves rather than throwing",
        (await FC.writeCommand("BIN-001", "OPEN", { role: "admin" })).ok === false);
  check("logEvent before start does the same",
        (await FC.logEvent("BIN-001", "hi", "info", "X")).ok === false);
  global.FIREBASE_CONFIG = realCfg;

  console.log("\nstart() is idempotent and reuses an existing app");
  resetCloud();
  installFirebase();
  FC = loadFleetCloud();
  check("start() reports success", FC.start() === true);
  check("one Firebase app was initialised", firebase.apps.length === 1);
  check("it subscribes to the bins collection", typeof cloud.binsListener === "function");
  check("status goes to connecting first", FC.status().state === "connecting");
  check("a second start() is free", FC.start() === true && firebase.apps.length === 1);

  /* A page where another script got there first must not initialise twice. */
  resetCloud();
  installFirebase();
  firebase.apps.push({ name: "[DEFAULT]" });
  const FC2 = loadFleetCloud();
  FC2.start();
  check("an app another script created is reused", firebase.apps.length === 1);

  console.log("\nA snapshot becomes overlays, in epoch milliseconds");
  resetCloud();
  installFirebase();
  FC = loadFleetCloud();
  FC.start();

  const T_COLLECTED = 1758499200000;
  const T_REPORTED  = 1758499260000;
  snapshot([{
    id: "BIN-001",
    data: {
      collectedAt:     makeTimestamp(T_COLLECTED),
      collectedByRole: "crew",
      manual:          true,
      lidOverride:     "OPEN",
      muted:           false,
      updatedAt:       makeTimestamp(T_COLLECTED),
      device: { fill: 72, lid: "CLOSED", status: "FULL", locked: true,
                reportedAt: makeTimestamp(T_REPORTED) },
      command:    { cmd: "OPEN", id: "c1", byRole: "crew", at: makeTimestamp(T_REPORTED) },
      commandAck: { id: "c1", result: "ok", at: makeTimestamp(T_REPORTED) },
      serverNoise: "ignore me"
    }
  }]);

  const ov = delivered.overlays[0].overlay;
  check("the overlay reaches SD under its bin id", delivered.overlays[0].id === "BIN-001");
  check("a top-level timestamp becomes milliseconds", ov.collectedAt === T_COLLECTED);
  check("updatedAt too", ov.updatedAt === T_COLLECTED);
  check("device.reportedAt is converted inside the map", ov.device.reportedAt === T_REPORTED);
  check("command.at is converted inside the map", ov.command.at === T_REPORTED);
  check("commandAck.at is converted inside the map", ov.commandAck.at === T_REPORTED);
  check("non-timestamp device fields are untouched", ov.device.fill === 72 && ov.device.locked === true);
  check("plain overlay fields survive", ov.collectedByRole === "crew" && ov.lidOverride === "OPEN");
  check("a false boolean is kept, not dropped", ov.muted === false);
  check("an unknown field is not passed on", ov.serverNoise === undefined);
  check("the status went live once data arrived", FC.status().state === "live");
  check("status() reports how many documents are in the fleet", FC.status().docs === 1);

  console.log("\nA pending server timestamp, and a removed document");
  snapshot([{ id: "BIN-002", data: { muted: true, updatedAt: null } }], 2);
  const pending = delivered.overlays[delivered.overlays.length - 1].overlay;
  check("a not-yet-stamped timestamp arrives as null rather than a crash", pending.updatedAt === null);
  check("the rest of the overlay still arrives", pending.muted === true);

  snapshot([{ id: "BIN-001", type: "removed", data: {} }], 1);
  const removal = delivered.overlays[delivered.overlays.length - 1];
  check("a deleted document is passed on as null", removal.id === "BIN-001" && removal.overlay === null);
  check("the document count follows the snapshot", FC.status().docs === 1);

  console.log("\nCommand -> overlay field mapping");
  resetCloud();
  installFirebase();
  FC = loadFleetCloud();
  FC.start();
  snapshot([{ id: "BIN-001", data: { muted: false } }]);   /* a plain, simulated bin */

  await FC.writeCommand("BIN-001", "OPEN", { role: "admin" });
  check("OPEN sets manual + lidOverride OPEN",
        lastWrite().data.manual === true && lastWrite().data.lidOverride === "OPEN");
  check("the write is a merge, so it never clobbers the device map", lastWrite().merge === true);
  check("updatedAt is always a server timestamp", lastWrite().data.updatedAt === SENTINEL);

  await FC.writeCommand("BIN-001", "CLOSE", { role: "admin" });
  check("CLOSE sets manual + lidOverride CLOSED",
        lastWrite().data.manual === true && lastWrite().data.lidOverride === "CLOSED");

  await FC.writeCommand("BIN-001", "AUTO", { role: "admin" });
  check("AUTO clears manual and nulls the override",
        lastWrite().data.manual === false && lastWrite().data.lidOverride === null);

  await FC.writeCommand("BIN-001", "MUTE", { role: "admin" });
  check("MUTE sets muted true", lastWrite().data.muted === true);

  await FC.writeCommand("BIN-001", "UNMUTE", { role: "admin" });
  check("UNMUTE sets muted false", lastWrite().data.muted === false);

  await FC.writeCommand("BIN-001", "PING", { role: "admin" });
  check("PING sets online true", lastWrite().data.online === true);

  await FC.writeCommand("BIN-001", "EMPTY", { role: "admin" });
  check("EMPTY stamps collectedAt on the server, never the client clock",
        lastWrite().data.collectedAt === SENTINEL);
  check("EMPTY records who did it", lastWrite().data.collectedByRole === "admin");

  await FC.writeCommand("BIN-001", "open", { role: "admin" });
  check("a lowercase command is accepted", lastWrite().data.lidOverride === "OPEN");

  const writesBefore = cloud.writes.length;
  const bad = await FC.writeCommand("BIN-001", "SELFDESTRUCT", { role: "admin" });
  check("an unknown command is refused locally, not sent", bad.ok === false);
  check("and nothing was written for it", cloud.writes.length === writesBefore);

  console.log("\nThe role the database will accept");
  await FC.writeCommand("BIN-001", "EMPTY", { role: "collector", label: "Crew - Ravi" });
  check("the site's 'collector' becomes the rules' 'crew'",
        lastWrite().data.collectedByRole === "crew");
  await FC.writeCommand("BIN-001", "EMPTY", { role: "owner" });
  check("owner is passed through", lastWrite().data.collectedByRole === "owner");
  await FC.writeCommand("BIN-001", "EMPTY", { role: "wizard" });
  check("an unknown role falls back to admin rather than being refused",
        lastWrite().data.collectedByRole === "admin");
  await FC.writeCommand("BIN-001", "EMPTY");
  check("no actor at all also falls back to admin", lastWrite().data.collectedByRole === "admin");

  console.log("\nOnly a device-linked bin gets a queued command");
  check("a simulated bin gets no command map", lastWrite().data.command === undefined);

  snapshot([{ id: "BIN-007", data: { device: { fill: 40, reportedAt: makeTimestamp(Date.now()) } } }]);
  await FC.writeCommand("BIN-007", "OPEN", { role: "collector" });
  const linked = lastWrite().data;
  check("a device-linked bin gets one", !!linked.command);
  check("the command names the command", linked.command.cmd === "OPEN");
  check("with a server timestamp", linked.command.at === SENTINEL);
  check("and the crew's role", linked.command.byRole === "crew");
  check("the id is a non-empty string the board can echo back",
        typeof linked.command.id === "string" && linked.command.id.length > 0 &&
        linked.command.id.length <= 40);

  const firstId = linked.command.id;
  await FC.writeCommand("BIN-007", "CLOSE", { role: "collector" });
  check("a second command gets a different id", lastWrite().data.command.id !== firstId);
  check("the overlay change is still written alongside it",
        lastWrite().data.lidOverride === "CLOSED");

  console.log("\nThe activity log needs a Firebase session");
  resetCloud();
  installFirebase();
  authUser = null;
  FC = loadFleetCloud();
  FC.start();
  snapshot([{ id: "BIN-001", data: {} }]);   /* the fleet is live before anyone signs in */
  let r = await FC.logEvent("BIN-001", "Marked as collected", "success", "Crew - Ravi");
  check("signed out, logEvent declines instead of being refused by the server", r.ok === false);
  check("and nothing was appended", cloud.added.length === 0);
  check("and no feed listener is opened for a signed-out page", cloud.eventsListener === null);

  /* Somebody signs in - exactly what the crew page does after the password
     is accepted, and what a page reload does when a session is restored. */
  authUser = { uid: "crew-uid" };
  authCb(authUser);
  r = await FC.logEvent("BIN-001", "Marked as collected", "success", "Crew - Ravi");
  check("signed in, the entry is appended", r.ok === true && cloud.added.length === 1);
  const ev = cloud.added[0];
  check("t is a server timestamp, so the feed cannot be reordered", ev.t === SENTINEL);
  check("uid is the signed-in account", ev.uid === "crew-uid");
  check("the name is carried as `by`", ev.by === "Crew - Ravi");
  check("the level is kept", ev.level === "success");

  await FC.logEvent("BIN-001", "x".repeat(200), "catastrophe", "y".repeat(100));
  const clipped = cloud.added[1];
  check("an over-long message is clipped to 140, not refused", clipped.msg.length === 140);
  check("an over-long name is clipped to 60", clipped.by.length === 60);
  check("an invented level falls back to info", clipped.level === "info");
  r = await FC.logEvent("BIN-001", "", "info", "X");
  check("an empty message is declined", r.ok === false && cloud.added.length === 2);

  console.log("\nThe events feed follows the Firebase session");
  check("signing in subscribed the feed", typeof cloud.eventsListener === "function");
  check("it is the ordered, limited query the rules expect",
        cloud.eventsQuery.order === "t desc" && cloud.eventsQuery.max === 40);

  const T_EVENT = 1758499300000;
  cloud.eventsListener({
    docs: [{ id: "e1", data: function () {
      return { t: makeTimestamp(T_EVENT), binId: "BIN-001", msg: "Marked as collected",
               level: "success", by: "Crew - Ravi" };
    } }]
  });
  check("events reach SD.applyCloudEvents", delivered.events && delivered.events.length === 1);
  check("with the timestamp in milliseconds", delivered.events[0].t === T_EVENT);
  check("and the id Firestore gave it", delivered.events[0].id === "e1");
  check("and the name of whoever did it", delivered.events[0].by === "Crew - Ravi");

  /* Not being staff or crew is not a fleet failure - the map keeps streaming. */
  cloud.eventsError(denied());
  check("a refused feed empties the shared log", delivered.events.length === 0);
  check("but leaves the fleet status alone", FC.status().state === "live");

  if (authCb) authCb(null);
  check("signing out drops the feed listener", cloud.unsubscribed.events >= 1);

  console.log("\nWith no auth SDK at all (the public map)");
  resetCloud();
  installFirebase({ auth: false });
  FC = loadFleetCloud();
  check("start() still succeeds", FC.start() === true);
  check("the bins listener is still attached", typeof cloud.binsListener === "function");
  check("no events listener is attempted", cloud.eventsListener === null);
  snapshot([{ id: "BIN-001", data: { muted: true } }]);
  check("the public map still goes live", FC.status().state === "live");
  r = await FC.logEvent("BIN-001", "hello", "info", "Public");
  check("logEvent declines rather than crashing on firebase.auth", r.ok === false);

  console.log("\nFailures become results, never exceptions");
  resetCloud();
  installFirebase();
  FC = loadFleetCloud();
  FC.start();
  snapshot([{ id: "BIN-001", data: {} }]);

  cloud.denyWrites = true;
  r = await FC.writeCommand("BIN-001", "OPEN", { role: "admin" });
  check("a refused write resolves { ok:false }", r.ok === false && !!r.error);
  check("and carries the Firestore code", r.error.code === "permission-denied");
  authUser = { uid: "u" };
  r = await FC.logEvent("BIN-001", "hi", "info", "X");
  check("a refused append does the same", r.ok === false && !!r.error);
  cloud.denyWrites = false;

  cloud.throwOnSet = true;
  r = await FC.writeCommand("BIN-001", "OPEN", { role: "admin" });
  check("even a synchronous throw comes back as a result", r.ok === false && !!r.error);
  cloud.throwOnSet = false;

  console.log("\nStatus transitions");
  resetCloud();
  installFirebase();
  FC = loadFleetCloud();
  const seen = [];
  const unsub = FC.onStatus(function (s) { seen.push(s.state); });
  check("before start the state is off", FC.status().state === "off");
  FC.start();
  check("start moves it to connecting", seen[seen.length - 1] === "connecting");
  snapshot([{ id: "BIN-001", data: {} }]);
  check("the first snapshot moves it to live", seen[seen.length - 1] === "live");
  const before = seen.length;
  snapshot([{ id: "BIN-001", data: { muted: true } }]);
  check("a further snapshot does not re-announce live", seen.length === before);

  cloud.binsError(denied());
  check("a listener failure moves it to error", FC.status().state === "error");
  check("and the listener was told", seen[seen.length - 1] === "error");
  check("the error is kept for the page to explain", FC.status().error.code === "permission-denied");
  unsub();
  const quiet = seen.length;
  snapshot([{ id: "BIN-001", data: {} }]);
  check("an unsubscribed listener stops hearing", seen.length === quiet);

  FC.stop();
  check("stop() releases the bins listener", cloud.unsubscribed.bins === 1);
  check("and returns the state to off", FC.status().state === "off");

  console.log("\nexplain() names the cause, not just the code");
  check("permission-denied blames unpublished rules or the account",
        /rules are not published yet/.test(FC.explain(denied())));
  check("...and says the database refused it",
        /^The database refused this change/.test(FC.explain(denied())));
  check("a bare message is recognised too",
        /rules are not published yet/.test(FC.explain(new Error("Missing or insufficient permissions."))));
  check("unavailable is a network problem",
        /unreachable/.test(FC.explain({ code: "unavailable" })));
  check("...and says the local copy still works",
        /nothing was shared/.test(FC.explain({ code: "unavailable" })));
  check("not-found explains an empty fleet is normal",
        /normal on a new project/.test(FC.explain({ code: "not-found" })));
  check("unauthenticated asks for a sign-in",
        /Sign in again/.test(FC.explain({ code: "unauthenticated" })));
  check("failed-precondition points at the console",
        /Firestore Database/.test(FC.explain({ code: "failed-precondition" })));
  check("resource-exhausted explains the free tier",
        /free tier/.test(FC.explain({ code: "resource-exhausted" })));
  check("an unknown error falls back to its own message",
        FC.explain(new Error("something odd")) === "something odd");
  check("explain survives being handed nothing",
        typeof FC.explain(null) === "string" && FC.explain(null).length > 0);

  console.log("\n----------------------------------------");
  console.log("  " + pass + " passed, " + fail + " failed");
  console.log("----------------------------------------\n");
  process.exit(fail ? 1 : 0);
})();

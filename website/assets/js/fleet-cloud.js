/* ==========================================================================
   fleet-cloud.js - the shared fleet, in Firestore
   --------------------------------------------------------------------------
   WHAT THIS IS FOR
   data.js can compute every bin's fill from the clock, so the numbers already
   agree on every screen without a database. What it cannot compute is what
   PEOPLE did: a collector pressing "Mark collected" on a phone, an
   administrator forcing a lid open, a real ESP32 reporting 72 %. Those are
   facts about the world, and they have to travel. This file is the only piece
   of the site that talks to the cloud about the fleet.

   THE SHAPE OF THE TRAFFIC
   Reads are a live subscription: one onSnapshot over `bins`, which delivers
   every later change on its own without polling. Writes happen only when a
   human presses a button. Nothing here writes on a timer, because the fill
   curve is a function of time that every browser already knows - if each open
   tab wrote its own simulated readings, forty tabs would mean forty
   conflicting writers and a burnt free tier by lunchtime.

   NEVER THROWS
   data.js treats a cloud call as something that may quietly fail, and this
   file honours that: every method returns { ok: false, error } rather than
   rejecting, and a page with no network, no Firebase config, or unpublished
   rules keeps working on its local copy. A dashboard that goes blank because
   a database is unreachable is a worse dashboard than one that says so.

   WORKS WITHOUT AN AUTH SDK
   index.html is the public map and loads no auth SDK at all. So the bins
   subscription must work with no sign-in (the rules make `bins` world
   readable), and everything auth-related - the activity log - is switched on
   only if firebase.auth is actually present AND somebody is signed in.
   ========================================================================== */

const FleetCloud = (function () {

  const BINS   = "bins";
  const EVENTS = "events";
  const EVENT_LIMIT = 40;              /* the feed every page shows */

  /* The overlay fields data.js understands. Anything else in a document is
     ignored rather than passed on, so a field added to the schema later
     cannot confuse an older page. */
  const OVERLAY_FIELDS = ["collectedAt", "collectedByRole", "manual", "lidOverride",
                          "muted", "online", "device", "command", "commandAck", "updatedAt"];

  /* Which keys inside each nested map are timestamps. data.js wants epoch
     milliseconds everywhere, so these get converted on the way in. */
  const NESTED_TS = { device: ["reportedAt"], command: ["at"], commandAck: ["at"] };
  const TOP_TS    = ["collectedAt", "updatedAt"];

  let db          = null;
  let started     = false;
  let state       = "off";             /* off | connecting | live | error */
  let lastError   = null;
  let docCount    = 0;
  let binsUnsub   = null;
  let eventsUnsub = null;
  let authUnsub   = null;

  /* The last overlay seen for each bin. Its only job is to answer "is this
     bin device-linked?" when a command is written - a bin with a real board
     behind it needs the command queued for the board to collect, a simulated
     one does not. */
  const overlays  = {};

  const statusListeners = [];

  /* ---- small guarded helpers ----------------------------------------- */
  function cfg() {
    return (typeof FIREBASE_CONFIG !== "undefined" && FIREBASE_CONFIG) ? FIREBASE_CONFIG : {};
  }

  function configured() {
    const fb = cfg().FIREBASE || {};
    return String(fb.apiKey || "").trim().length > 0 &&
           String(fb.projectId || "").trim().length > 0;
  }

  function sdkPresent() {
    return typeof firebase !== "undefined" &&
           typeof firebase.initializeApp === "function" &&
           typeof firebase.firestore === "function";
  }

  /* index.html deliberately does not load firebase-auth-compat. */
  function authPresent() {
    return sdkPresent() && typeof firebase.auth === "function";
  }

  function currentUser() {
    if (!authPresent()) return null;
    try { return firebase.auth().currentUser || null; } catch (e) { return null; }
  }

  function serverTime() {
    return firebase.firestore.FieldValue.serverTimestamp();
  }

  function setState(next, err) {
    /* Once the fleet is live, a later hiccup is worth reporting but a repeat
       of the same state is not - the pages redraw on every status change. */
    if (state === next && (err || null) === lastError) return;
    state = next;
    lastError = err || null;
    statusListeners.slice().forEach(function (fn) {
      try { fn(status()); } catch (e) { if (typeof console !== "undefined") console.error(e); }
    });
  }

  function status() {
    return { state: state, error: lastError, docs: docCount };
  }

  function onStatus(fn) {
    if (typeof fn !== "function") return function () {};
    statusListeners.push(fn);
    return function () {
      const i = statusListeners.indexOf(fn);
      if (i >= 0) statusListeners.splice(i, 1);
    };
  }

  /* ---- Firestore Timestamp -> epoch milliseconds ---------------------
     A Timestamp written with serverTimestamp() is momentarily null in the
     writer's own snapshot, because the server has not stamped it yet. We ask
     for { serverTimestamps: "estimate" } so it arrives as the local guess
     instead, which stops a just-emptied bin flickering back to full for a
     second on the phone that emptied it. */
  function toMs(v) {
    if (v === null || v === undefined) return v;
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (typeof v.toMillis === "function") { try { return v.toMillis(); } catch (e) { return null; } }
    if (typeof Date !== "undefined" && v instanceof Date) return v.getTime();
    /* A plain { seconds, nanoseconds } - what a Timestamp looks like once it
       has been through JSON, e.g. in a test stub. */
    if (typeof v.seconds === "number") return v.seconds * 1000 + Math.round((v.nanoseconds || 0) / 1e6);
    return null;
  }

  /* Copy the fields data.js knows about, converting every timestamp - top
     level and nested - to milliseconds on the way. */
  function toOverlay(data) {
    const out = {};
    if (!data || typeof data !== "object") return out;

    OVERLAY_FIELDS.forEach(function (key) {
      const v = data[key];
      if (v === undefined) return;

      if (TOP_TS.indexOf(key) !== -1) { out[key] = toMs(v); return; }

      const tsKeys = NESTED_TS[key];
      if (tsKeys && v && typeof v === "object") {
        const map = {};
        Object.keys(v).forEach(function (k) {
          map[k] = tsKeys.indexOf(k) !== -1 ? toMs(v[k]) : v[k];
        });
        out[key] = map;
        return;
      }
      out[key] = v;
    });
    return out;
  }

  function deliverOverlay(id, overlay) {
    if (overlay) overlays[id] = overlay; else delete overlays[id];
    try {
      if (typeof SD !== "undefined" && SD && typeof SD.applyCloudOverlay === "function") {
        SD.applyCloudOverlay(id, overlay);
      }
    } catch (e) { if (typeof console !== "undefined") console.error(e); }
  }

  function deliverEvents(list) {
    try {
      if (typeof SD !== "undefined" && SD && typeof SD.applyCloudEvents === "function") {
        SD.applyCloudEvents(list);
      }
    } catch (e) { if (typeof console !== "undefined") console.error(e); }
  }

  /* ---- start ----------------------------------------------------------
     Idempotent: three scripts on admin.html may each call it, and the second
     and third calls must be free. */
  function start() {
    if (started) return true;
    if (!configured() || !sdkPresent()) { setState("off", null); return false; }

    try {
      if (!firebase.apps.length) firebase.initializeApp(cfg().FIREBASE);
      db = firebase.firestore();
    } catch (e) {
      setState("error", e);
      return false;
    }

    started = true;
    setState("connecting", null);
    watchBins();
    watchAuth();
    return true;
  }

  function watchBins() {
    try {
      binsUnsub = db.collection(BINS).onSnapshot(function (snap) {
        docCount = snap.size;
        snap.docChanges().forEach(function (change) {
          const id = change.doc.id;
          if (change.type === "removed") { deliverOverlay(id, null); return; }
          const data = change.doc.data({ serverTimestamps: "estimate" });
          deliverOverlay(id, toOverlay(data));
        });
        setState("live", null);
      }, function (err) {
        /* In production Firestore denies everything until rules are published,
           so this is overwhelmingly the most likely first failure - and the
           one whose default message explains it least. */
        setState("error", err);
      });
    } catch (e) {
      setState("error", e);
    }
  }

  /* ---- the activity log ------------------------------------------------
     Unlike `bins`, `events` carries people's names and so is not public. The
     listener therefore follows the Firebase session: subscribe when someone
     signs in, drop it when they sign out. A refusal here is not a fleet-wide
     failure - it just means this person is not staff or crew - so it stops
     the listener quietly rather than turning the whole page red. */
  function watchAuth() {
    if (!authPresent()) return;
    try {
      authUnsub = firebase.auth().onAuthStateChanged(function (user) {
        if (user) watchEvents(); else stopEvents();
      });
    } catch (e) { /* no auth session available; the fleet still streams */ }
  }

  function stopEvents() {
    if (eventsUnsub) { try { eventsUnsub(); } catch (e) {} }
    eventsUnsub = null;
    deliverEvents([]);
  }

  function watchEvents() {
    if (eventsUnsub || !db) return;
    try {
      eventsUnsub = db.collection(EVENTS)
        .orderBy("t", "desc")
        .limit(EVENT_LIMIT)
        .onSnapshot(function (snap) {
          const list = snap.docs.map(function (d) {
            const v = d.data({ serverTimestamps: "estimate" }) || {};
            return {
              id:    d.id,
              t:     toMs(v.t),
              binId: v.binId || "",
              msg:   v.msg || "",
              level: v.level || "info",
              by:    v.by || ""
            };
          });
          deliverEvents(list);
        }, function () {
          stopEvents();     /* not staff or crew - no shared feed for them */
        });
    } catch (e) { stopEvents(); }
  }

  /* Used by the tests, and worth having: a page that signs out should be able
     to let go of its listeners. */
  function stop() {
    if (binsUnsub) { try { binsUnsub(); } catch (e) {} }
    if (authUnsub) { try { authUnsub(); } catch (e) {} }
    binsUnsub = null;
    authUnsub = null;
    stopEvents();
    started = false;
    docCount = 0;
    setState("off", null);
  }

  /* ---- writing a command ----------------------------------------------
     The overlay fields each command changes. These mirror COMMANDS in
     data.js exactly: the page applies the change locally at once and the
     same change goes to the cloud, so the two never describe different
     things. `updatedAt` is added to every one of them - the rules require
     it, and it is what tells a device-linked bin's model that a person has
     acted since the board last reported. */
  function patchFor(cmd, role) {
    switch (cmd) {
      case "OPEN":   return { manual: true,  lidOverride: "OPEN" };
      case "CLOSE":  return { manual: true,  lidOverride: "CLOSED" };
      case "AUTO":   return { manual: false, lidOverride: null };
      case "MUTE":   return { muted: true };
      case "UNMUTE": return { muted: false };
      case "PING":   return { online: true };
      case "EMPTY":  return { collectedAt: serverTime(), collectedByRole: role };
      default:       return null;
    }
  }

  /* The rules accept three roles, and "collector" is what the site calls the
     crew internally. Translating here rather than at the call site means a
     page cannot accidentally write a role the database will refuse. */
  function normaliseRole(actor) {
    let role = String((actor || {}).role || "admin");
    if (role === "collector") role = "crew";
    if (role !== "owner" && role !== "admin" && role !== "crew") role = "admin";
    return role;
  }

  /* Short, unique, and no crypto dependency: the id only has to be different
     from the last one so a board can tell a new command from a repeat. */
  function commandId() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function writeCommand(binId, cmd, actor) {
    if (!started || !db) return Promise.resolve({ ok: false, error: "cloud not started" });

    cmd = String(cmd || "").toUpperCase();
    const role  = normaliseRole(actor);
    const patch = patchFor(cmd, role);
    if (!patch) return Promise.resolve({ ok: false, error: "unknown command " + cmd });

    patch.updatedAt = serverTime();

    /* Only a bin with a real board behind it needs a queued command; for a
       simulated bin the overlay change IS the whole story, and writing a
       command nobody will ever collect would just be litter. */
    const linked = !!(overlays[binId] && overlays[binId].device);
    if (linked) {
      patch.command = { cmd: cmd, id: commandId(), at: serverTime(), byRole: role };
    }

    try {
      return db.collection(BINS).doc(binId).set(patch, { merge: true })
        .then(function () { return { ok: true }; },
              function (e) { return { ok: false, error: e }; });
    } catch (e) {
      return Promise.resolve({ ok: false, error: e });
    }
  }

  /* ---- the shared activity log ---------------------------------------
     Only a signed-in account may append, because the rules pin `uid` to the
     caller. An unsigned page keeps its own local feed instead - see addLog
     in data.js. */
  function logEvent(binId, msg, level, byLabel) {
    if (!started || !db) return Promise.resolve({ ok: false, error: "cloud not started" });

    const user = currentUser();
    if (!user) return Promise.resolve({ ok: false, error: "not signed in" });

    const entry = {
      t:     serverTime(),
      binId: String(binId || "").slice(0, 12),
      msg:   String(msg || "").slice(0, 140),
      level: ["info", "success", "warn", "error"].indexOf(level) !== -1 ? level : "info",
      by:    String(byLabel || "Dashboard").slice(0, 60),
      uid:   user.uid
    };
    if (!entry.msg) return Promise.resolve({ ok: false, error: "empty message" });

    try {
      return db.collection(EVENTS).add(entry)
        .then(function () { return { ok: true }; },
              function (e) { return { ok: false, error: e }; });
    } catch (e) {
      return Promise.resolve({ ok: false, error: e });
    }
  }

  /* ---- saying what went wrong -----------------------------------------
     Firestore's own messages name the error but not the cause, and for this
     project there is almost always one specific cause. Guessing badly here
     costs an afternoon, so each message ends with the thing to go and do. */
  function explain(err) {
    const code = String((err && (err.code || err.name)) || err || "").toLowerCase();
    const text = String((err && err.message) || err || "");

    if (code.indexOf("permission-denied") !== -1 || /insufficient permissions/i.test(text)) {
      return "The database refused this change. Either the Firestore rules " +
             "are not published yet, or this account is not allowed to make it.";
    }
    if (code.indexOf("unauthenticated") !== -1) {
      return "The database wants a signed-in account for this. Sign in again.";
    }
    if (code.indexOf("unavailable") !== -1 || code.indexOf("network") !== -1) {
      return "The cloud is unreachable - probably no network. The page keeps " +
             "working on this browser's copy, and nothing was shared.";
    }
    if (code.indexOf("not-found") !== -1) {
      return "That document is not in the database. If the whole fleet is " +
             "missing, nobody has written to it yet - that is normal on a new project.";
    }
    if (code.indexOf("failed-precondition") !== -1) {
      return "Firestore needs an index for this query, or the database has " +
             "not been created yet: Firebase console > Firestore Database.";
    }
    if (code.indexOf("resource-exhausted") !== -1) {
      return "The Firebase free tier's daily quota is used up. It resets at " +
             "midnight Pacific time; until then the site runs on local data.";
    }
    if (code.indexOf("cloud not started") !== -1 || code.indexOf("not signed in") !== -1) {
      return text || code;
    }
    return text || "Unknown cloud error.";
  }

  return {
    configured:   configured,
    start:        start,
    stop:         stop,
    status:       status,
    onStatus:     onStatus,
    writeCommand: writeCommand,
    logEvent:     logEvent,
    explain:      explain
  };
})();

/* Node (tests) - in the browser `module` does not exist. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { FleetCloud: FleetCloud };
}

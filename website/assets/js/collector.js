/* ==========================================================================
   collector.js - the collection crew's page (collector.html)
   --------------------------------------------------------------------------
   WHO THIS IS FOR
   The crew on the truck, on a phone. They need three things and nothing
   else: which bins to empty, in what order, and a button that hands the
   route to Google Maps. Everything the admin console can do that the crew
   should not (bulk commands, muting, resetting, managing people) is simply
   not on this page - and the Firestore rules refuse it anyway.

   HOW THE CREW SIGNS IN
   One shared crew password, but NOT a password checked in JavaScript: it is
   a real Firebase email/password account (FIREBASE_CONFIG.COLLECTOR_EMAIL).
   Google's servers check the password, the page never stores it, and the
   Firestore rules recognise the crew's UID - so a crew member can mark a
   bin collected but cannot, say, rewrite the admin list. Each person types
   their own name, which goes into the activity log ("Crew - Ravi").
   Owners and administrators who are already signed in skip the card.

   IT MUST WORK WITHOUT THE CLOUD
   If FleetCloud is missing or not live (no network, rules not published),
   planning and "Mark collected" still work on this phone's local data; the
   status pill says the changes are not shared.

   Sections
     1. depot + small helpers
     2. deciding what to show (session check)
     3. crew sign-in
     4. the app: planning
     5. the app: rendering (KPIs, map, legs, stops)
     6. the app: crew actions (open lid, mark collected)
     7. cloud status pill + start-up
   ========================================================================== */

/* The collection crew's depot: where the truck starts and unloads.
   Source: OpenStreetMap way 236036933 (amenity=townhall,
   name:en="Greater Hyderabad Municipal Corporation"), coordinates from the
   Photon geocoder (photon.komoot.io, OSM data), checked 2026-09-22. */
const COLLECTOR_DEPOT = {
  name: "GHMC Head Office, Tank Bund Road, Lower Tank Bund",
  short: "Depot - GHMC Head Office",
  lat: 17.4078,
  lng: 78.4755
};

(function () {

  /* =====================================================================
     1. HELPERS
     =================================================================== */
  const $ = function (id) { return document.getElementById(id); };

  const esc = (typeof escapeHtml === "function") ? escapeHtml : function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  };

  const NAME_KEY     = "smartdustbin.crew.name";      /* remembered: harmless */
  const SETTINGS_KEY = "smartdustbin.crew.settings";
  const STAFF_ROLES  = ["owner", "admin"];
  const APP_ROLES    = ["collector", "owner", "admin"];

  /* A bin marked collected stays off re-plans for this long: enough for the
     rest of a shift, short enough that a bin which fills up again later in
     the day comes back on the list. */
  const COLLECTED_HOLD_MS = 2 * 3600 * 1000;

  const toastEl = $("toast");
  let toastTimer = null;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, ms || 2800);
  }

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  /* ---- Firebase plumbing, every call guarded ------------------------- */
  function firebaseConfigured() {
    if (typeof FIREBASE_CONFIG === "undefined" || !FIREBASE_CONFIG.FIREBASE) return false;
    const fb = FIREBASE_CONFIG.FIREBASE;
    return String(fb.apiKey || "").trim() !== "" && String(fb.projectId || "").trim() !== "";
  }

  /* Returns true when the Firebase app + auth SDK are usable. Reuses the app
     another script (FleetCloud) may already have initialised. */
  function authReady() {
    if (typeof firebase === "undefined" || typeof firebase.initializeApp !== "function") return false;
    if (typeof firebase.auth !== "function" || !firebaseConfigured()) return false;
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG.FIREBASE);
      return true;
    } catch (e) { return false; }
  }

  function crewEmail() {
    return (typeof FIREBASE_CONFIG !== "undefined")
      ? String(FIREBASE_CONFIG.COLLECTOR_EMAIL || "").trim() : "";
  }

  function collectorUids() {
    const list = (typeof FIREBASE_CONFIG !== "undefined") ? FIREBASE_CONFIG.COLLECTOR_UIDS : null;
    if (!Array.isArray(list)) return [];
    return list.map(function (u) { return String(u || "").trim(); })
               .filter(function (u) { return u.length > 0; });
  }

  /* Firebase restores a signed-in user asynchronously; wait for the first
     answer (or give up) before deciding the crew session is gone. */
  function waitForFirebaseUser(timeoutMs) {
    if (!authReady()) return Promise.resolve(null);
    const auth = firebase.auth();
    if (auth.currentUser) return Promise.resolve(auth.currentUser);
    return new Promise(function (resolve) {
      let done = false;
      const finish = function (u) { if (!done) { done = true; resolve(u || null); } };
      const timer = setTimeout(function () { finish(null); }, timeoutMs || 4000);
      const unsub = auth.onAuthStateChanged(function (u) {
        clearTimeout(timer);
        if (typeof unsub === "function") unsub();
        finish(u);
      });
    });
  }

  function cloudPresent() { return typeof FleetCloud !== "undefined" && FleetCloud; }

  function explainCloud(err) {
    if (cloudPresent() && typeof FleetCloud.explain === "function") {
      try { return FleetCloud.explain(err); } catch (e) {}
    }
    return (err && err.message) || String(err || "unknown error");
  }

  function fmtInt(n) { return Math.round(n).toLocaleString("en-IN"); }

  /* =====================================================================
     2. WHAT TO SHOW
     =================================================================== */
  function showSignin(message) {
    $("appView").classList.add("hidden");
    document.querySelectorAll(".crew-only").forEach(function (el) { el.classList.add("hidden"); });
    $("dashLink").classList.add("hidden");
    $("signinView").classList.remove("hidden");
    setupSignin();
    if (message) showError(message);
  }

  function boot() {
    const s = (typeof AUTH !== "undefined") ? AUTH.currentSession() : null;
    if (s && APP_ROLES.indexOf(s.role) !== -1) {
      startApp(s);
      /* A crew session is only as good as the Firebase sign-in behind it: if
         that has gone (signed out in another tab, browser restarted), cloud
         writes would all be refused. Check quietly and ask again if so. */
      if (s.method === "crew" && authReady()) {
        waitForFirebaseUser().then(function (u) {
          if (!u || (s.uid && u.uid !== s.uid)) {
            AUTH.logout();
            window.location.replace("collector.html?expired=1");
          }
        });
      }
      return;
    }
    let msg = null;
    if (/[?&]expired=1/.test(location.search)) msg = "Your crew session has ended. Please sign in again.";
    showSignin(msg);
  }

  /* =====================================================================
     3. CREW SIGN-IN
     =================================================================== */
  const errBox = $("signinError");
  function showError(msg) { errBox.textContent = msg; errBox.classList.add("show"); }
  function hideError() { errBox.textContent = ""; errBox.classList.remove("show"); }

  /* Why crew sign-in cannot work here, or null if it can. */
  function setupProblem() {
    if (!crewEmail()) return "COLLECTOR_EMAIL is empty in firebase-config.js.";
    if (!authReady()) return "The Firebase sign-in library did not load (or Firebase is not configured).";
    return null;
  }

  let signinWired = false;
  function setupSignin() {
    const problem = setupProblem();
    $("setupBox").classList.toggle("hidden", !problem);
    $("setupReason").textContent = problem ? "Right now: " + problem : "";
    $("crewForm").classList.toggle("hidden", !!problem);
    if (problem || signinWired) return;
    signinWired = true;

    const saved = (function () { try { return localStorage.getItem(NAME_KEY) || ""; } catch (e) { return ""; } })();
    if (saved) $("crewName").value = saved;
    ($("crewName").value ? $("crewPassword") : $("crewName")).focus();

    $("crewForm").addEventListener("submit", onSignin);
  }

  /* 1-40 visible characters, whitespace collapsed, control characters out.
     It is printed in the shared activity log, so keep it plain. */
  function cleanName(raw) {
    const s = Array.from(String(raw || ""))
      .filter(function (ch) { const c = ch.charCodeAt(0); return c >= 32 && c !== 127; })
      .join("").replace(/\s+/g, " ").trim();
    return (s.length >= 1 && s.length <= 40) ? s : "";
  }

  const WRONG_PASSWORD_CODES = ["auth/invalid-credential", "auth/wrong-password",
                                "auth/user-not-found", "auth/invalid-login-credentials"];

  /* Firebase's codes are exact but its messages are written for developers.
     A wrong password also costs one of the five tries (AUTH's lockout, the
     same counter login.html uses); a network or setup failure does not. */
  function explainSignin(err) {
    const code = (err && err.code) || "";
    if (WRONG_PASSWORD_CODES.indexOf(code) !== -1) {
      if (typeof AUTH.noteFailure !== "function") return "Wrong crew password.";
      const f = AUTH.noteFailure();
      return f.locked
        ? "Wrong crew password. Too many failed attempts - locked for " + Math.round(f.seconds / 60) + " minute."
        : "Wrong crew password. " + f.left + " attempt(s) left.";
    }
    switch (code) {
      case "auth/operation-not-allowed":
        return "Email/Password sign-in is not enabled on the Firebase project. Owner: " +
               "Firebase console > Authentication > Sign-in method > enable Email/Password.";
      case "auth/too-many-requests":
        return "Google has paused sign-in from this device after too many attempts. " +
               "Wait a few minutes and try again.";
      case "auth/network-request-failed":
        return "No connection to Google. Check the phone's mobile data or Wi-Fi and try again.";
      case "auth/user-disabled":
        return "The crew account has been disabled. Ask the owner.";
      case "auth/invalid-email":
        return "COLLECTOR_EMAIL in firebase-config.js is not a valid address. Ask the owner.";
      case "auth/configuration-not-found":
        return "Authentication is not set up on this Firebase project yet. Owner: " +
               "Firebase console > Authentication > Get started.";
      case "auth/unauthorized-domain":
        return "This website is not on the Firebase authorised-domains list. Owner: " +
               "Authentication > Settings > Authorised domains > add " + location.hostname + ".";
      default:
        return "Sign-in failed: " + ((err && err.message) || "unknown error") + ".";
    }
  }

  async function onSignin(e) {
    e.preventDefault();
    hideError();

    const pwEl = $("crewPassword");
    const pw = pwEl.value;
    pwEl.value = "";                     /* never left sitting in the page */
    const name = cleanName($("crewName").value);

    const wait = (typeof AUTH.lockedForSeconds === "function") ? AUTH.lockedForSeconds() : 0;
    if (wait > 0) { showError("Too many attempts. Try again in " + wait + "s."); return; }
    if (!name) { showError("Please enter your name (1 to 40 characters) - it goes in the activity log."); $("crewName").focus(); return; }
    if (!pw)   { showError("Please enter the crew password."); pwEl.focus(); return; }

    const btn = $("crewBtn");
    btn.disabled = true;
    btn.textContent = "Signing in...";

    try {
      const auth = firebase.auth();
      /* SESSION persistence: the crew login ends when the tab closes, the same
         lifetime as the site's own session - right for a shared phone. */
      try { await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION); } catch (x) {}

      const cred = await auth.signInWithEmailAndPassword(crewEmail(), pw);
      const uid = cred && cred.user ? cred.user.uid : null;

      const allowed = collectorUids();
      if (allowed.length && allowed.indexOf(uid) === -1) {
        try { await auth.signOut(); } catch (x) {}
        showError("This account (UID " + uid + ") is not on the crew list, so it has no access. " +
                  "Ask the owner to add it to COLLECTOR_UIDS and to firestore.rules.");
        return;
      }

      if (typeof AUTH.clearFailures === "function") AUTH.clearFailures();
      try { localStorage.setItem(NAME_KEY, name); } catch (x) {}

      const session = AUTH.startSession({
        username: "crew",
        name:     "Crew - " + name,
        role:     "collector",
        method:   "crew",
        uid:      uid
      });
      $("signinView").classList.add("hidden");
      startApp(session);
    } catch (err) {
      showError(explainSignin(err));
      pwEl.focus();
    } finally {
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  }

  /* =====================================================================
     4. THE APP - PLANNING
     =================================================================== */
  let session = null;
  let active = false;        /* the app is showing for a live session */
  let wired = false;         /* map, listeners and timer set up (once per page load) */
  let map = null, mapLayer = null;
  let plan = null;           /* see makePlan() */
  const collected = {};      /* binId -> ms when this phone marked it collected */

  function actor() {
    return {
      role:  session.role === "collector" ? "crew" : session.role,
      label: session.name
    };
  }

  function settings() {
    return {
      startMode:   $("startMode").value,
      zone:        $("zoneSel").value,
      truckCap:    Math.max(100, Number($("truckCap").value) || 4000),
      perLink:     Number($("perLink").value) === 3 ? 3 : 9,
      incNear:     $("incNear").checked,
      incOffline:  $("incOffline").checked,
      returnStart: $("returnStart").checked,
      withOrigin:  $("withOrigin").checked
    };
  }

  function restoreSettings() {
    const s = readJson(SETTINGS_KEY);
    if (!s) return;
    if (["depot", "me", "first"].indexOf(s.startMode) !== -1) $("startMode").value = s.startMode;
    if (s.truckCap) $("truckCap").value = s.truckCap;
    if (s.perLink === 3 || s.perLink === 9) $("perLink").value = String(s.perLink);
    ["incNear", "incOffline", "returnStart", "withOrigin"].forEach(function (k) {
      if (typeof s[k] === "boolean") $(k).checked = s[k];
    });
    if (s.zone && Array.prototype.some.call($("zoneSel").options, function (o) { return o.value === s.zone; })) {
      $("zoneSel").value = s.zone;
    }
  }

  function litresOf(bin) {
    return (Number(bin.capacity) || 0) * Math.max(0, Math.min(100, Number(bin.fill) || 0)) / 100;
  }

  /* Which bins need the truck, most urgent first: locked (full and turning
     people away) before merely full, full before near-full, then by fill;
     offline / faulty bins last, since they are an inspection, not a pickup. */
  function candidates(opts) {
    const now = Date.now();
    const rank = function (b) {
      const st = SD.statusOf(b);
      if (st === "offline" || st === "error") return 3;
      if (b.locked) return 0;
      return st === "full" ? 1 : 2;
    };
    return SD.getFleet().filter(function (b) {
      if (opts.zone && b.zone !== opts.zone) return false;
      if (collected[b.id] && now - collected[b.id] < COLLECTED_HOLD_MS) return false;
      const st = SD.statusOf(b);
      if (st === "offline" || st === "error") return opts.incOffline;
      if (st === "full") return true;
      if (st === "warning") return opts.incNear;
      return false;
    }).sort(function (a, b) {
      return (rank(a) - rank(b)) || (b.fill - a.fill) || (a.id < b.id ? -1 : 1);
    });
  }

  /* The truck holds so many litres. Take bins in urgency order while they
     fit; whatever does not fit waits for a second trip after unloading.
     That keeps one planned route = one truckload. */
  function fitTruck(list, capLitres) {
    const chosen = [], deferred = [];
    let load = 0;
    list.forEach(function (b) {
      const l = litresOf(b);
      if (load + l <= capLitres) { chosen.push(b); load += l; }
      else deferred.push(b);
    });
    return { chosen: chosen, deferred: deferred };
  }

  function locate() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) { resolve({ error: "this browser cannot share its location" }); return; }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude,
                    name: "Your location", short: "your location" });
        },
        function (err) {
          resolve({ error: err && err.code === 1 ? "location permission was refused"
                         : err && err.code === 3 ? "finding the location took too long"
                         : "the location is unavailable" });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    });
  }

  async function makePlan() {
    const opts = settings();
    writeJson(SETTINGS_KEY, opts);

    let start = null, startLabel = "the fullest bin";
    if (opts.startMode === "depot") {
      start = COLLECTOR_DEPOT; startLabel = COLLECTOR_DEPOT.short;
    } else if (opts.startMode === "me") {
      $("planNote").textContent = "Finding your location...";
      const here = await locate();
      if (here.error) {
        toast("Could not use your location (" + here.error + "). Planning from the depot.", 4500);
        start = COLLECTOR_DEPOT; startLabel = COLLECTOR_DEPOT.short;
      } else {
        start = here; startLabel = "your location";
      }
    }

    const picked = fitTruck(candidates(opts), opts.truckCap);
    const p = RoutePlanner.plan(picked.chosen, { start: start, returnToStart: opts.returnStart });

    plan = {
      ids:        p.order.map(function (b) { return b.id; }),
      snapshot:   p.order,                     /* bin records as planned */
      km:         p.km,
      est:        RoutePlanner.estimate(p, p.order),
      start:      start,                       /* null = began at the first stop */
      startLabel: startLabel,
      returnToStart: opts.returnStart,
      deferred:   picked.deferred.map(function (b) { return b.id; }),
      truckCap:   opts.truckCap,
      at:         Date.now()
    };

    const n = plan.ids.length;
    $("planNote").textContent = n
      ? "Planned " + n + " stop" + (n === 1 ? "" : "s") + " at " + clock(plan.at) +
        ", starting from " + startLabel + "." +
        (plan.deferred.length ? " " + plan.deferred.length + " more wait for a second trip (truck full)." : "")
      : "Nothing needs collecting with these options right now.";

    renderAll();
    fitRoute();
  }

  function clock(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  /* The bin as it is NOW (fill, lock, status move on), falling back to the
     record captured at planning time. */
  function liveBin(id, i) {
    return SD.getBin(id) || plan.snapshot[i];
  }

  /* =====================================================================
     5. THE APP - RENDERING
     =================================================================== */

  /* Rebuilding a list with innerHTML throws away keyboard focus; put it
     back on the same control so a 5-second refresh cannot yank it away. */
  function keepFocus(container, rebuild) {
    const a = document.activeElement;
    const key = (a && container.contains(a) && a.getAttribute("data-key")) || null;
    rebuild();
    if (key) {
      const again = container.querySelector('[data-key="' + key + '"]');
      if (again) again.focus();
    }
  }

  function renderKpis() {
    const opts = settings();
    const fleet = SD.getFleet().filter(function (b) { return !opts.zone || b.zone === opts.zone; });
    let due = 0, near = 0, locked = 0;
    fleet.forEach(function (b) {
      const st = SD.statusOf(b);
      if (st === "full") due++;
      if (st === "warning") near++;
      if (b.locked) locked++;
    });
    $("kDue").textContent  = due;
    $("kDueSub").textContent = locked ? locked + " locked - turning people away" : "90% and above";
    $("kNear").textContent = near;

    if (!plan) return;
    const done = plan.ids.filter(function (id) { return collected[id]; }).length;
    $("kStops").textContent = plan.ids.length - done;
    $("kStopsSub").textContent = plan.ids.length
      ? "left of " + plan.ids.length + (done ? " - " + done + " collected" : "")
      : "nothing to collect";
    $("kKm").textContent   = plan.est.roadKm;
    $("kMin").textContent  = plan.est.minutes;
    $("kLoad").innerHTML   = fmtInt(plan.est.litres) + "<small>L</small>";
    $("kLoadSub").textContent = "of a " + fmtInt(plan.truckCap) + " L truck" +
      (plan.deferred.length ? " - " + plan.deferred.length + " deferred" : "");
  }

  /* ---- map ------------------------------------------------------------ */
  function initMap() {
    if (typeof L === "undefined" || !L || !L.map) return;     /* list fallback below */
    try {
      map = L.map("crewMap", { zoomControl: true, scrollWheelZoom: false })
             .setView([COLLECTOR_DEPOT.lat, COLLECTOR_DEPOT.lng], 12);
      /* Same light CARTO basemap as the admin map, so the coloured stops
         carry the visual weight. */
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
      }).addTo(map);
      mapLayer = L.layerGroup().addTo(map);
    } catch (e) { map = null; }
  }

  function routePoints() {
    if (!plan) return [];
    const pts = [];
    if (plan.start) pts.push([plan.start.lat, plan.start.lng]);
    plan.ids.forEach(function (id, i) { const b = liveBin(id, i); pts.push([b.lat, b.lng]); });
    if (plan.returnToStart && pts.length > 1) pts.push(pts[0]);
    return pts;
  }

  function renderMap() {
    if (!map) { renderMapFallback(); return; }
    mapLayer.clearLayers();

    /* depot / start marker */
    const start = plan ? plan.start : COLLECTOR_DEPOT;
    if (start) {
      const isMe = start !== COLLECTOR_DEPOT;
      L.marker([start.lat, start.lng], {
        title: isMe ? "Your location" : COLLECTOR_DEPOT.name,
        keyboard: true,
        zIndexOffset: 1000,
        icon: L.divIcon({
          className: "crew-icon",
          html: isMe ? '<div class="me-marker"></div>' : '<div class="depot-marker">D</div>',
          iconSize: isMe ? [18, 18] : [30, 30],
          iconAnchor: isMe ? [9, 9] : [15, 15]
        })
      }).bindPopup(isMe ? "<b>Your location</b>"
                        : "<b>Depot</b><br>" + esc(COLLECTOR_DEPOT.name))
        .addTo(mapLayer);
    }
    if (!plan || !plan.ids.length) return;

    /* straight-line preview of the visiting order */
    L.polyline(routePoints(), {
      className: "crew-route-line",      /* CSS gives it the theme's accent colour */
      color: "#0071e3", weight: 3, opacity: .75, dashArray: "6 6", interactive: false
    }).addTo(mapLayer);

    plan.ids.forEach(function (id, i) {
      const b = liveBin(id, i);
      const st = SD.statusOf(b);
      const cls = "stop-marker s-" + st + (collected[id] ? " is-done" : "") + (b.locked ? " is-locked" : "");
      L.marker([b.lat, b.lng], {
        title: "Stop " + (i + 1) + ": " + b.id + " " + b.name,
        keyboard: true,
        icon: L.divIcon({
          className: "crew-icon",
          html: '<div class="' + cls + '">' + (i + 1) + '</div>',
          iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14]
        })
      }).bindPopup(
        "<b>" + (i + 1) + ". " + esc(b.id) + " " + esc(b.name) + "</b><br>" +
        esc(b.zone) + " &middot; " + (b.online ? Math.round(b.fill) + "% full" : "offline") +
        (b.locked ? ' &middot; <span class="badge-locked">Locked</span>' : "") +
        (collected[id] ? "<br>Collected" : "")
      ).addTo(mapLayer);
    });
  }

  /* No Leaflet (offline, blocked CDN): the order still matters more than
     the picture, so show it as a list instead of failing. */
  function renderMapFallback() {
    const el = $("crewMap");
    if (!plan || !plan.ids.length) {
      el.innerHTML = '<div class="crew-map-fallback"><p class="muted">Map unavailable ' +
                     '(the map library did not load). Plan a route to see the stops in order.</p></div>';
      return;
    }
    el.innerHTML = '<div class="crew-map-fallback"><p class="muted">Map unavailable ' +
      '(the map library did not load). Stops in order from ' + esc(plan.startLabel) + ':</p><ol>' +
      plan.ids.map(function (id, i) {
        const b = liveBin(id, i);
        return "<li" + (collected[id] ? ' class="is-done"' : "") + ">" + esc(b.id) + " " + esc(b.name) + "</li>";
      }).join("") + "</ol></div>";
  }

  function fitRoute() {
    if (!map) return;
    const pts = routePoints();
    if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
    else if (pts.length === 1) map.setView(pts[0], 14);
    else map.setView([COLLECTOR_DEPOT.lat, COLLECTOR_DEPOT.lng], 12);
  }

  /* ---- Google Maps legs --------------------------------------------- */
  function renderLegs() {
    const box = $("legList");
    if (!plan || !plan.ids.length) {
      box.innerHTML = '<p class="muted">Plan a route to get Google Maps links.</p>';
      return;
    }
    const opts = settings();
    const order = plan.ids.map(liveBin);
    let legs = [];
    try {
      legs = RoutePlanner.legs(plan.start, order, {
        returnToStart: plan.returnToStart,
        maxWaypoints: opts.perLink,
        includeOrigin: opts.withOrigin
      });
    } catch (e) {
      box.innerHTML = '<p class="muted">Could not build the Google Maps links: ' + esc(e.message) + '</p>';
      return;
    }

    let stopNo = 0;
    keepFocus(box, function () {
      box.innerHTML = legs.map(function (leg) {
        const first = stopNo + 1;
        stopNo += leg.stops.length;
        const done = leg.stops.length > 0 && leg.stops.every(function (b) { return collected[b.id]; });
        const what = leg.stops.length
          ? "Stops " + (first === stopNo ? first : first + "-" + stopNo) +
            (leg.returnsToStart ? ", then back to the start" : "")
          : "Back to the start";
        return '<div class="leg-item' + (done ? " is-done" : "") + '">' +
                 '<div class="leg-text"><b>Leg ' + leg.index + ' of ' + legs.length + '</b>' +
                   esc(what) + (done ? " - done" : "") + '</div>' +
                 '<a class="btn btn-sm btn-primary" target="_blank" rel="noopener" data-key="leg' + leg.index + '" ' +
                   'href="' + esc(leg.url) + '" aria-label="Open leg ' + leg.index + ' in Google Maps">' +
                   'Open in Google Maps</a>' +
               '</div>';
      }).join("");
    });
  }

  /* ---- stop list ------------------------------------------------------ */
  function stopButtons(b, i) {
    const opts = settings();
    const off = !b.online;               /* a sensor-fault bin is online: commands still work */
    const label = esc(b.id);
    const openDisabled = off ? ' disabled title="Device offline - open the lid by hand"' : "";
    const collectDisabled = (off && !opts.incOffline) ? ' disabled title="Device offline"' : "";
    return '<div class="stop-actions">' +
      '<button type="button" class="btn btn-sm" data-act="open" data-id="' + label + '" data-key="open' + i + '"' +
        openDisabled + ' aria-label="Open the lid of ' + label + ' (crew override)">Open lid</button>' +
      '<button type="button" class="btn btn-sm btn-primary" data-act="collect" data-id="' + label + '" data-key="collect' + i + '"' +
        collectDisabled + ' aria-label="Mark ' + label + ' as collected">Mark collected</button>' +
    '</div>';
  }

  function stopNote(b) {
    const st = SD.statusOf(b);
    const opts = settings();
    if (!b.online) {
      return opts.incOffline
        ? '<div class="stop-note">Inspect: the device is offline - check the bin and empty it by hand.</div>'
        : '<div class="stop-note">The device has gone offline since planning.</div>';
    }
    if (st === "error") return '<div class="stop-note">Inspect: sensor fault - check the level by eye.</div>';
    if (b.locked) return '<div class="stop-note is-locked">Full and locked - &ldquo;Open lid&rdquo; overrides the lock for emptying.</div>';
    return "";
  }

  function renderStops() {
    const list = $("stopList");
    if (!plan) {
      list.innerHTML = '<li class="stop-empty">Press &ldquo;Plan route&rdquo; to build today&rsquo;s stops.</li>';
      $("stopsCount").textContent = "";
      $("deferredBox").innerHTML = "";
      return;
    }
    if (!plan.ids.length) {
      list.innerHTML = '<li class="stop-empty">Nothing needs collecting with these options. ' +
                       'Every bin is below the threshold.</li>';
      $("stopsCount").textContent = "0 stops";
      $("deferredBox").innerHTML = "";
      return;
    }

    const done = plan.ids.filter(function (id) { return collected[id]; }).length;
    $("stopsCount").textContent = done + " of " + plan.ids.length + " collected";

    keepFocus(list, function () {
      let prev = plan.start;
      list.innerHTML = plan.ids.map(function (id, i) {
        const b = liveBin(id, i);
        const st = SD.statusOf(b);
        const isDone = !!collected[id];
        const from = prev
          ? RoutePlanner.haversineKm(prev, b).toFixed(1) + " km from " +
            (i === 0 ? (plan.start === COLLECTOR_DEPOT ? "the depot" : "your location") : "stop " + i)
          : "first stop";
        prev = b;
        return '<li class="stop-item' + (isDone ? " is-done" : "") + '">' +
          '<span class="stop-num s-' + st + '" aria-hidden="true">' + (i + 1) + '</span>' +
          '<div class="stop-main">' +
            '<div class="stop-title"><span class="sr-only">Stop ' + (i + 1) + ': </span>' +
              '<b>' + esc(b.id) + '</b> ' + esc(b.name) +
              (b.locked && !isDone ? ' <span class="badge-locked">Locked</span>' : "") + '</div>' +
            '<div class="stop-meta">' + esc(b.zone) + ' &middot; ' +
              (b.online ? Math.round(b.fill) + "% full" : "no reading") + ' &middot; ' +
              SD.statusLabel(st) + ' &middot; ' + from + '</div>' +
            (isDone
              ? '<div class="stop-done-tag">Collected at ' + clock(collected[id]) + '</div>'
              : stopNote(b) + stopButtons(b, i)) +
          '</div>' +
        '</li>';
      }).join("");
    });

    $("deferredBox").innerHTML = plan.deferred.length
      ? '<div class="stop-deferred"><b>Second trip (truck full):</b> ' +
        plan.deferred.map(function (id) {
          const b = SD.getBin(id);
          return esc(id) + (b ? " " + esc(b.name) : "");
        }).join(", ") + '. Unload at the depot, then plan again.</div>'
      : "";
  }

  function renderAll() {
    if (!active) return;
    /* the site session expires after two hours - stop acting on a dead one */
    if (!AUTH.currentSession()) {
      active = false;
      showSignin("Your session has expired. Please sign in again.");
      return;
    }
    renderKpis();
    renderMap();
    renderLegs();
    renderStops();
    updatePill();
  }

  /* Cloud snapshots can arrive in bursts; coalesce them into one redraw. */
  let pending = false;
  function scheduleRender() {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; renderAll(); }, 30);
  }

  /* =====================================================================
     6. CREW ACTIONS
     =================================================================== */

  /* Toast the local result at once; if the change is also going to the
     cloud, wait for it and say so plainly when the database refuses. */
  async function report(id, r, quietOnSuccess) {
    if (!r) return;
    if (!quietOnSuccess || !r.ok) toast(id + ": " + r.message);
    scheduleRender();
    if (r.ok && r.cloud && typeof r.cloud.then === "function") {
      let res;
      try { res = await r.cloud; } catch (e) { res = { ok: false, error: e }; }
      if (!res || !res.ok) {
        toast(id + ": saved on this phone only. " + explainCloud(res && res.error), 7000);
      }
    }
  }

  async function openLid(id) {
    const b = SD.getBin(id);
    if (!b) return;
    if (!b.online) { toast(id + ": the device is offline - open the lid by hand."); return; }
    /* Opening a LOCKED bin is the crew's job (the lock stops the public, not
       the crew). Opening an unlocked one is unusual, so ask first. */
    if (!b.locked && !confirm(id + " is not locked. Open its lid anyway (crew override)?")) return;
    await report(id, SD.sendCommand(id, "OPEN", actor()));
  }

  async function markCollected(id) {
    const b = SD.getBin(id);
    if (!b) return;

    if (!b.online) {
      /* A dead device cannot take commands, but the crew emptying it by hand
         is still worth recording in the shared log. */
      SD.addLog(id, "Emptied by hand - device offline (" + actor().label + ")", "warn", { cloud: true });
      collected[id] = Date.now();
      toast(id + ": recorded as emptied by hand.");
      scheduleRender();
      return;
    }

    const wasForced = !!b.manual;
    const r = SD.sendCommand(id, "EMPTY", actor());
    if (r && r.ok) collected[id] = Date.now();
    await report(id, r);
    /* If the crew forced the lid open, hand it back to the sensor once the
       bin is empty - otherwise it would stay open all night. */
    if (r && r.ok && wasForced) await report(id, SD.sendCommand(id, "AUTO", actor()), true);
  }

  function wireActions() {
    $("stopList").addEventListener("click", function (e) {
      const btn = e.target.closest ? e.target.closest("button[data-act]") : null;
      if (!btn || btn.disabled) return;
      const id = btn.getAttribute("data-id");
      if (btn.getAttribute("data-act") === "open") openLid(id);
      else markCollected(id);
    });

    $("planForm").addEventListener("submit", async function (e) {
      e.preventDefault();
      const btn = $("planBtn");
      btn.disabled = true;
      btn.textContent = "Planning...";
      try { await makePlan(); }
      catch (err) { toast("Could not plan the route: " + err.message, 5000); }
      finally { btn.disabled = false; btn.textContent = "Plan route"; }
    });

    /* These change how the current plan is shown, not the plan itself. */
    ["perLink", "withOrigin"].forEach(function (id) {
      $(id).addEventListener("change", function () { writeJson(SETTINGS_KEY, settings()); renderLegs(); });
    });
    $("incOffline").addEventListener("change", function () { writeJson(SETTINGS_KEY, settings()); renderStops(); });
    $("zoneSel").addEventListener("change", renderKpis);

    $("fitBtn").addEventListener("click", fitRoute);

    $("logoutBtn").addEventListener("click", async function () {
      if (authReady()) { try { await firebase.auth().signOut(); } catch (e) {} }
      if (window.google && google.accounts && google.accounts.id) {
        try { google.accounts.id.disableAutoSelect(); } catch (e) {}
      }
      AUTH.logout();
      window.location.replace("collector.html");
    });
  }

  /* =====================================================================
     7. CLOUD STATUS + START-UP
     =================================================================== */
  function updatePill() {
    const pill = $("cloudPill");
    let state = "local", text = "Local demo - not shared", tip = "";
    if (cloudPresent() && typeof FleetCloud.status === "function") {
      let st = {};
      try { st = FleetCloud.status() || {}; } catch (e) {}
      if (st.state === "live") {
        state = "live"; text = "Live - shared with the city dashboard";
      } else if (st.state === "connecting") {
        state = "connecting"; text = "Connecting...";
      } else if (st.state === "error") {
        state = "error"; text = "Cloud error - working on this phone";
        tip = st.error ? explainCloud(st.error) : "";
      }
    }
    if (pill.getAttribute("data-state") !== state) pill.setAttribute("data-state", state);
    if (pill.textContent !== text) pill.textContent = text;
    pill.title = tip;
  }

  function startCloud() {
    if (!cloudPresent()) return;
    try {
      if (typeof FleetCloud.configured !== "function" || FleetCloud.configured()) {
        if (typeof FleetCloud.start === "function") FleetCloud.start();
      }
      if (typeof FleetCloud.onStatus === "function") FleetCloud.onStatus(function () { updatePill(); });
    } catch (e) { /* the page works locally without it */ }
  }

  function startApp(s) {
    session = s;
    $("signinView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    document.querySelectorAll(".crew-only").forEach(function (el) { el.classList.remove("hidden"); });
    if (STAFF_ROLES.indexOf(s.role) !== -1) $("dashLink").classList.remove("hidden");

    const roleText = s.role === "collector" ? "Collection crew"
                   : (typeof Users !== "undefined" ? Users.roleLabel(s.role) : s.role);
    $("whoami").textContent = s.name;
    $("footUser").textContent = s.name;
    $("crewWho").textContent = "Signed in as " + s.name + " (" + roleText + ")";

    /* First crew sign-in, before the owner has registered the crew UID:
       everything works on this phone, but the database will refuse to
       share it until the UID is in the rules. Say exactly what to send. */
    if (s.method === "crew" && collectorUids().length === 0) {
      const n = $("setupNotice");
      n.innerHTML = "<b>One setup step left.</b> Send this UID to the owner: <code>" +
        esc(s.uid || "unknown") + "</code>. Until it is added to <code>COLLECTOR_UIDS</code> " +
        "in firebase-config.js and to <code>collectorUids()</code> in firestore.rules, your " +
        "changes are saved on this phone but the database will not share them.";
      n.classList.remove("hidden");
    }

    if (typeof SD === "undefined" || typeof RoutePlanner === "undefined") {
      const f = $("fatalNotice");
      f.textContent = "The fleet data or the route planner did not load. Reload the page; " +
                      "if it keeps happening, the site files are out of date.";
      f.classList.remove("hidden");
      return;
    }
    active = true;
    if (wired) { renderAll(); return; }     /* signed in again after an expiry */
    wired = true;

    SD.getZones().forEach(function (z) {
      const o = document.createElement("option");
      o.value = z; o.textContent = z;
      $("zoneSel").appendChild(o);
    });
    restoreSettings();
    /* Options open by default on a wide screen, folded away on a phone
       where the map and the stops matter more. */
    if (window.matchMedia && window.matchMedia("(min-width: 900px)").matches) $("planOptions").open = true;

    initMap();
    wireActions();
    startCloud();

    if (typeof SD.onChange === "function") SD.onChange(scheduleRender);
    setInterval(function () {
      if (typeof SD.tick === "function") SD.tick();
      renderAll();
    }, 5000);

    renderAll();
    /* Plan straight away so the crew sees work, not a blank page - except
       from "my location", which would pop a permission prompt on load. */
    if ($("startMode").value !== "me") makePlan();
    else $("planNote").textContent = 'Press "Plan route" to plan from your location.';
  }

  boot();
})();

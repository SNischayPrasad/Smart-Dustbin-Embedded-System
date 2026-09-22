/* ==========================================================================
   user-admin.js - the owner-only user management console
   --------------------------------------------------------------------------
   WHAT THIS CAN AND CANNOT DO

   The site is static, so there is no database and no API to POST to. This
   page therefore does two separate things, and is careful not to blur them:

     1. It edits an in-memory copy of the registry, so a change takes effect
        immediately in this browser and can be demonstrated.
     2. It generates the exact users.js content to commit, which is what
        makes the change real for everyone else.

   The in-memory copy is deliberately NOT persisted. Writing roles into
   localStorage would mean anyone could grant themselves ownership from
   DevTools and have it stick, turning a documented limitation into an actual
   back door. Reload and you are back to the committed registry - the file on
   disk stays the single source of truth.
   ========================================================================== */
(function () {

  const session = AUTH.currentSession();
  if (!session || !Users.can(session.role, "canManageUsers")) return;

  /* Defined here rather than pulled in from data.js: that file is the fleet
     layer and this page has no business loading it just for one helper. */
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }

  document.getElementById("whoami").textContent =
    session.name + " (" + Users.roleLabel(session.role) + ")";
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
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
  }

  /* ---- which backend are we on? --------------------------------------- */
  const CLOUD = (typeof UserStore !== "undefined") && UserStore.configured();

  function setBackendBanner() {
    const el = document.getElementById("backendNote");
    if (!el) return;
    if (CLOUD) {
      const err = UserStore.lastError && UserStore.lastError();
      el.innerHTML = err
        ? "<b>Cloud store unreachable.</b> Showing the registry committed in " +
          "<code>users.js</code>. Changes here cannot be saved until the " +
          "connection returns. (" + escapeHtml(err) + ")"
        : "<b>Cloud store connected.</b> Adding or removing someone takes " +
          "effect immediately for everyone. Firestore Security Rules decide " +
          "whether the write is allowed &mdash; not this page.";
      el.style.borderLeftColor = err ? "var(--full)" : "var(--ok)";
      el.style.background = err ? "rgba(255,59,48,.07)" : "rgba(52,199,89,.08)";
    } else {
      el.innerHTML = "<b>No cloud store configured.</b> This site is static, " +
        "so changes apply in your browser only until you commit the generated " +
        "<code>users.js</code> below. Fill in " +
        "<code>assets/js/firebase-config.js</code> to make them instant and shared.";
    }
  }

  /* Show the owner their Firebase UID - they need it for firestore.rules. */
  function showUid(message) {
    const el   = document.getElementById("uidNote");
    const copy = document.getElementById("copyUidBtn");
    if (!el) return;

    if (message) { el.textContent = message; return; }

    if (typeof UserStore === "undefined" || !UserStore.configured()) {
      el.textContent = "Firebase is not configured yet - fill in firebase-config.js.";
      return;
    }

    const uid = UserStore.currentUid();
    if (uid) {
      el.textContent = uid;
      if (copy) copy.classList.remove("hidden");
    } else {
      el.textContent = "No Firebase session yet. Press “Connect to Firebase” below.";
      if (copy) copy.classList.add("hidden");
    }
  }

  /* Direct Firebase popup, so a UID can be obtained before the rules or the
     OWNER_UID are in place. Errors are shown on screen rather than hidden in
     the console, because every one of them is a setup step the reader still
     has to do. */
  const connectBtn = document.getElementById("fbConnectBtn");
  if (connectBtn) {
    if (typeof UserStore === "undefined" || !UserStore.configured()) {
      connectBtn.disabled = true;
      connectBtn.title = "Fill in firebase-config.js first";
    }
    connectBtn.addEventListener("click", async function () {
      connectBtn.disabled = true;
      const original = connectBtn.textContent;
      connectBtn.textContent = "Opening Google…";
      showUid("Waiting for the Google window…");
      try {
        const user = await UserStore.signInWithPopup();
        showUid();
        toast("Connected to Firebase as " + (user.email || user.uid));
        await UserStore.hydrate();
        working = USER_DB.USERS.map(function (u) { return Object.assign({}, u); });
        setBackendBanner();
        render();
      } catch (e) {
        showUid("Could not connect.\n\n" + UserStore.explain(e));
      } finally {
        connectBtn.disabled = false;
        connectBtn.textContent = original;
      }
    });
  }

  /* A single button that answers the question the Firestore error will not:
     three different causes all surface as "insufficient permissions". */
  const diagBtn = document.getElementById("diagBtn");
  if (diagBtn) {
    diagBtn.addEventListener("click", function () {
      const out = document.getElementById("diagOut");
      const uid  = (typeof UserStore !== "undefined") ? UserStore.currentUid() : null;
      const want = (typeof FIREBASE_CONFIG !== "undefined") ? FIREBASE_CONFIG.OWNER_UID : "";
      out.classList.remove("hidden");
      out.innerHTML =
        "<b>Firebase configured:</b> " + (UserStore.configured() ? "yes" : "no") + "<br>" +
        "<b>Signed in to Firebase:</b> " + (uid ? "yes" : "<b>no</b>") + "<br>" +
        "<b>Your Firebase UID:</b> " + (uid ? uid : "none") + "<br>" +
        "<b>Owner UID expected:</b> " + (want || "not set") + "<br>" +
        "<b>They match:</b> " + (uid && want && uid === want ? "yes" : "<b>no</b>") + "<br><br>" +
        escapeHtml(UserStore.diagnoseWriteRefusal());
    });
  }

  const copyUidBtn = document.getElementById("copyUidBtn");
  if (copyUidBtn) {
    copyUidBtn.addEventListener("click", async function () {
      const uid = UserStore.currentUid();
      if (!uid) return;
      try { await navigator.clipboard.writeText(uid); toast("UID copied"); }
      catch (e) { toast("Clipboard blocked - select the text and copy"); }
    });
  }

  /* ---- working copy ---------------------------------------------------- */
  const COMMITTED = USER_DB.USERS.map(function (u) { return Object.assign({}, u); });
  let working     = USER_DB.USERS.map(function (u) { return Object.assign({}, u); });
  let dirty       = false;

  function apply() {
    USER_DB.USERS = working.map(function (u) { return Object.assign({}, u); });
    render();
  }

  function countRole(r) {
    return working.filter(function (u) { return u.role === r; }).length;
  }

  /* ---- rendering ------------------------------------------------------- */
  function render() {
    document.getElementById("userRows").innerHTML = working.map(function (u, i) {
      const digest = u.emailHash
        ? "<code style='font-size:12px'>" + u.emailHash.slice(0, 12) + "&hellip;</code>"
        : "<span class='muted'>plain: " + escapeHtml(u.email) + "</span>";
      const manages = Users.can(u.role, "canManageUsers");
      const lastOwner = u.role === "owner" && countRole("owner") === 1;
      const badge = u.role === "owner" ? "full" : (u.role === "admin" ? "ok" : "offline");

      return "<tr>" +
        "<td><b>" + escapeHtml(u.name) + "</b></td>" +
        "<td><span class='badge badge-" + badge + "'><span class='dot'></span>" +
          Users.roleLabel(u.role) + "</span></td>" +
        "<td>" + digest + "</td>" +
        "<td>" + (manages ? "yes" : "no") + "</td>" +
        "<td>" + (lastOwner
          ? "<span class='muted'>last owner</span>"
          : "<button class='btn btn-sm btn-danger' data-remove='" + i + "'>Remove</button>") +
        "</td></tr>";
    }).join("");

    document.getElementById("regSummary").textContent =
      countRole("owner") + " owner, " + countRole("admin") + " admin, " +
      countRole("viewer") + " viewer";

    Array.prototype.forEach.call(document.querySelectorAll("[data-remove]"), function (b) {
      b.addEventListener("click", function () {
        const i = parseInt(b.getAttribute("data-remove"), 10);
        const who = working[i];
        if (!confirm("Remove " + who.name + " from the registry?")) return;

        if (CLOUD && who.source === "cloud") {
          UserStore.removeUser(who.emailHash).then(function () {
            working.splice(i, 1);
            apply();
            toast(who.name + " removed for everyone");
          }).catch(function (e) {
            toast("Refused: " + e.message);
          });
          return;
        }

        working.splice(i, 1);
        dirty = true;
        apply();
        toast(who.source === "committed" && CLOUD
          ? who.name + " is in users.js - remove them there and commit"
          : who.name + " removed - commit users.js to make it stick");
      });
    });

    document.getElementById("pendingNote").textContent = dirty
      ? "Unsaved changes in this browser. Commit the generated file to publish them."
      : "No changes yet.";

    document.getElementById("generated").textContent = generated();
  }

  /* ---- the file to commit ---------------------------------------------- */
  function generated() {
    const body = working.map(function (u) {
      const key = u.emailHash
        ? '{ emailHash: "' + u.emailHash + '",'
        : '{ email: "' + u.email + '",';
      return "    " + key + "\n      name: \"" + u.name + "\", role: \"" + u.role + "\" }";
    }).join(",\n\n");
    return "  USERS: [\n" + body + "\n  ],";
  }

  /* ---- add someone ------------------------------------------------------ */
  const errBox = document.getElementById("addError");
  function showError(msg) { errBox.textContent = msg; errBox.classList.add("show"); }

  document.getElementById("addBtn").addEventListener("click", async function () {
    errBox.classList.remove("show");

    const email = document.getElementById("newEmail").value.trim();
    const name  = document.getElementById("newName").value.trim();
    const role  = document.getElementById("newRole").value;

    if (!email || email.indexOf("@") < 1 || email.indexOf(".") === -1) {
      return showError("That does not look like an email address.");
    }
    if (!name) {
      return showError("Give them a display name, so the registry stays readable.");
    }

    const hash = await Users.sha256Hex(Users.normalise(email));

    const clash = working.some(function (u) {
      return (u.emailHash || "").toLowerCase() === hash ||
             (u.email && Users.normalise(u.email) === Users.normalise(email));
    });
    if (clash) return showError("That address is already in the registry.");

    const entry = { emailHash: hash, name: name, role: role };

    if (CLOUD) {
      /* Check what we can see locally first, so the reader gets a cause
         rather than Firestore's one-size-fits-all refusal. */
      if (!UserStore.currentUid()) {
        return showError(UserStore.diagnoseWriteRefusal());
      }
      try {
        await UserStore.addUser(entry);
        entry.source = "cloud";
        working.push(entry);
        apply();
        document.getElementById("newEmail").value = "";
        document.getElementById("newName").value  = "";
        toast(name + " added as " + Users.roleLabel(role) + " - live for everyone");
      } catch (e) {
        /* A refusal here is Security Rules doing their job. */
        showError("Refused by Firestore. " + UserStore.diagnoseWriteRefusal());
      }
      return;
    }

    working.push(entry);
    dirty = true;
    apply();
    document.getElementById("newEmail").value = "";
    document.getElementById("newName").value  = "";
    toast(name + " added as " + Users.roleLabel(role) + " - now commit users.js");
  });

  /* ---- standalone hasher ------------------------------------------------ */
  document.getElementById("hashBtn").addEventListener("click", async function () {
    const v = document.getElementById("hashInput").value.trim();
    const out = document.getElementById("hashOut");
    if (!v) { out.textContent = "Enter an address first."; return; }
    const h = await Users.sha256Hex(Users.normalise(v));
    out.textContent = h + "\n\n{ emailHash: \"" + h + "\",\n  name: \"Their Name\", role: \"admin\" }";
  });

  /* =======================================================================
     CLOUD SETUP - the two things that go wrong after this page works

     Everything above manages the registry. These two cards manage the gap
     between the registry and the DATABASE, which is where the confusing
     failures live: the page happily offers an administrator the console, and
     then Firestore refuses every write, because the rules look somewhere the
     page never had to.
     ===================================================================== */

  function cfg(key, dflt) {
    if (typeof FIREBASE_CONFIG === "undefined" || !FIREBASE_CONFIG) return dflt;
    const v = FIREBASE_CONFIG[key];
    return (v === undefined || v === null) ? dflt : v;
  }

  /* A raw Firestore handle for the read-only probes below. UserStore owns the
     registry collection; this is deliberately separate, because these checks
     must be able to report that the cloud is broken without UserStore having
     decided the same thing first and fallen back. */
  function rawDb() {
    if (typeof UserStore === "undefined" || !UserStore.init()) return null;
    try { return firebase.firestore(); } catch (e) { return null; }
  }

  /* ---- Sync registry to cloud ------------------------------------------- */
  const syncBtn = document.getElementById("syncBtn");
  const syncOut = document.getElementById("syncOut");

  function sayInSync(html) { if (syncOut) syncOut.innerHTML = html; }

  if (syncBtn) {
    if (!CLOUD) {
      syncBtn.disabled = true;
      syncBtn.title = "Fill in firebase-config.js first";
      sayInSync("No cloud store is configured, so there is nothing to sync to.");
    }

    syncBtn.addEventListener("click", async function () {
      if (!UserStore.currentUid()) {
        sayInSync(escapeHtml(UserStore.diagnoseWriteRefusal()));
        return;
      }

      syncBtn.disabled = true;
      const original = syncBtn.textContent;
      syncBtn.textContent = "Syncing…";
      sayInSync("Reading the cloud registry…");

      try {
        const inCloud = await UserStore.loadCloud();
        const have = {};
        inCloud.forEach(function (c) { have[String(c.emailHash || "").toLowerCase()] = true; });

        const committed = USER_DB.COMMITTED_USERS || USER_DB.USERS || [];
        let added = 0, already = 0, skipped = 0;
        const failed = [];

        for (const u of committed) {
          /* A committed row may carry a plain address instead of a digest.
             Hash it here rather than writing the address - the whole point of
             the digest is that the address never reaches the database. */
          let hash = String(u.emailHash || "").toLowerCase();
          if (!hash && u.email) hash = await Users.sha256Hex(Users.normalise(u.email));
          if (hash.length !== 64 || ["owner", "admin", "viewer"].indexOf(u.role) === -1) {
            skipped++;
            continue;
          }
          if (have[hash]) { already++; continue; }

          try {
            await UserStore.addUser({ emailHash: hash, name: u.name, role: u.role });
            added++;
          } catch (e) {
            failed.push(u.name);
          }
        }

        await UserStore.hydrate();
        working = USER_DB.USERS.map(function (x) { return Object.assign({}, x); });
        setBackendBanner();
        render();

        let msg = "<b>" + added + "</b> added, <b>" + already + "</b> already there";
        if (skipped) msg += ", " + skipped + " skipped (no usable digest or role)";
        msg += ".";
        if (failed.length) {
          msg += "<br><br><b>Refused for:</b> " + escapeHtml(failed.join(", ")) + "<br>" +
                 escapeHtml(UserStore.diagnoseWriteRefusal());
        } else if (added) {
          msg += " Those people are now recognised by the database itself, " +
                 "not just by this page.";
        }
        sayInSync(msg);
        toast(added ? added + " entr" + (added === 1 ? "y" : "ies") + " synced"
                    : "Registry already in sync");
      } catch (e) {
        sayInSync("Could not sync.<br>" + escapeHtml(UserStore.explain(e)));
      } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = original;
      }
    });
  }

  /* ---- Cloud setup check ------------------------------------------------ */
  const checkBtn = document.getElementById("cloudCheckBtn");
  const checkOut = document.getElementById("cloudCheckOut");

  /* PASS / TODO rather than a tick and a cross: every TODO here is a specific
     thing to go and do, and the line says what it is. */
  function checkLine(state, title, detail) {
    const colour = state === "PASS" ? "var(--ok)" : "var(--warn)";
    return '<div style="margin-bottom:.45rem">' +
             '<b style="color:' + colour + ';font-family:var(--mono);font-size:12px">' +
               state + '</b>&nbsp; ' + title +
             (detail ? '<div style="margin-left:2.9rem;font-size:13px;opacity:.85">' +
                       detail + '</div>' : '') +
           '</div>';
  }

  async function runCloudCheck() {
    const out = [];

    if (!CLOUD) {
      checkOut.innerHTML = checkLine("TODO", "Firebase is not configured",
        "Fill in the FIREBASE block in <code>assets/js/firebase-config.js</code>.");
      return;
    }

    /* a. Can anyone read the fleet? This is the single most useful probe on
          the page: production Firestore denies everything until the rules are
          published, so a refusal here explains every other failure. */
    const db = rawDb();
    let binSnap = null;
    if (!db) {
      out.push(checkLine("TODO", "Firestore SDK unavailable",
        "This page could not create a Firestore handle."));
    } else {
      try {
        binSnap = await db.collection("bins").limit(50).get();
        out.push(checkLine("PASS", "Rules are published",
          "The <code>bins</code> collection is readable, which is what the public map needs. " +
          binSnap.size + " bin document" + (binSnap.size === 1 ? "" : "s") + " so far."));
      } catch (e) {
        out.push(checkLine("TODO", "Publish <code>firestore.rules</code>",
          "Reading <code>bins</code> was refused: " + escapeHtml(UserStore.explain(e)) +
          " Firebase console &gt; Firestore Database &gt; Rules &gt; paste the file &gt; Publish."));
      }
    }

    /* b. Is this browser actually an owner as far as the database is
          concerned? Being signed in to the SITE is a different thing. */
    const uid = UserStore.currentUid();
    if (!uid) {
      out.push(checkLine("TODO", "Connect this browser to Firebase",
        "Press &ldquo;Connect to Firebase&rdquo; above. Signing in to the site is not the same session."));
    } else if (UserStore.isOwnerUid(uid)) {
      out.push(checkLine("PASS", "You are an owner in the database",
        "<code>" + escapeHtml(uid) + "</code>"));
    } else {
      out.push(checkLine("TODO", "This Firebase account is not an owner",
        "<code>" + escapeHtml(uid) + "</code> is not in OWNER_UIDS. Add it to " +
        "<code>firebase-config.js</code> and <code>firestore.rules</code>, then Publish."));
    }

    /* c. The crew account. */
    const crew = cfg("COLLECTOR_UIDS", []);
    if (Array.isArray(crew) && crew.length) {
      out.push(checkLine("PASS", "Collection crew account registered",
        crew.length + " UID" + (crew.length === 1 ? "" : "s") + " in COLLECTOR_UIDS."));
    } else {
      out.push(checkLine("TODO", "Create the collection crew account",
        "1. Authentication &gt; Sign-in method &gt; enable Email/Password.<br>" +
        "2. Authentication &gt; Users &gt; Add user: <code>" +
          escapeHtml(String(cfg("COLLECTOR_EMAIL", "the crew address"))) +
        "</code> with a strong password.<br>" +
        "3. Copy its UID into COLLECTOR_UIDS in <code>firebase-config.js</code> " +
        "<b>and</b> <code>collectorUids()</code> in <code>firestore.rules</code>, then Publish.<br>" +
        "Until then collector.html works on the phone but every write is refused."));
    }

    /* d. Real hardware, and how recently it spoke. A board that is registered
          but silent is a different problem from one that is not registered. */
    const devices = cfg("DEVICE_BINS", {});
    const deviceCount = devices && typeof devices === "object" ? Object.keys(devices).length : 0;
    let newest = 0, newestBin = "";
    if (binSnap) {
      binSnap.forEach(function (doc) {
        const dev = (doc.data() || {}).device;
        const at = dev && dev.reportedAt && typeof dev.reportedAt.toMillis === "function"
                 ? dev.reportedAt.toMillis() : 0;
        if (at > newest) { newest = at; newestBin = doc.id; }
      });
    }
    if (deviceCount) {
      out.push(checkLine("PASS", "Device account registered",
        deviceCount + " board" + (deviceCount === 1 ? "" : "s") + " in DEVICE_BINS." +
        (newest ? " Newest report: " + escapeHtml(newestBin) + ", " + timeAgoLocal(newest) + "."
                : " No board has reported yet.")));
    } else {
      out.push(checkLine("TODO", "No device registered (optional)",
        "Only needed for a real ESP32 or a Wokwi board &mdash; the site is a complete " +
        "demonstration without one. To add one: Authentication &gt; Users &gt; Add user with " +
        "the address from <code>secrets.h</code>, then put its UID in DEVICE_BINS and " +
        "<code>deviceBins()</code>." +
        (newest ? " (Something is already reporting into " + escapeHtml(newestBin) + ", " +
                  timeAgoLocal(newest) + ".)" : "")));
    }

    /* e. Is everyone in users.js actually in the cloud registry? */
    try {
      const inCloud = await UserStore.loadCloud();
      const have = {};
      inCloud.forEach(function (c) { have[String(c.emailHash || "").toLowerCase()] = true; });
      const committed = USER_DB.COMMITTED_USERS || USER_DB.USERS || [];
      const missing = committed.filter(function (u) {
        const h = String(u.emailHash || "").toLowerCase();
        return h && !have[h];
      });
      if (!missing.length) {
        out.push(checkLine("PASS", "Committed registry is in the cloud",
          committed.length + " committed entr" + (committed.length === 1 ? "y" : "ies") +
          ", all present in <code>admins</code>."));
      } else {
        out.push(checkLine("TODO", missing.length + " committed " +
          (missing.length === 1 ? "person is" : "people are") + " missing from the cloud",
          escapeHtml(missing.map(function (u) { return u.name; }).join(", ")) +
          " &mdash; press &ldquo;Sync registry to cloud&rdquo; below. Until then the database " +
          "will refuse their writes even though this page lets them in."));
      }
    } catch (e) {
      out.push(checkLine("TODO", "Could not read the cloud registry",
        escapeHtml(UserStore.explain(e))));
    }

    checkOut.innerHTML = out.join("");
  }

  /* data.js is the fleet layer and this page has no business loading it, so
     the one helper it would have provided is repeated here. */
  function timeAgoLocal(ts) {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60)    return s + "s ago";
    if (s < 3600)  return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }

  if (checkBtn && checkOut) {
    checkBtn.addEventListener("click", async function () {
      checkBtn.disabled = true;
      const original = checkBtn.textContent;
      checkBtn.textContent = "Checking…";
      checkOut.innerHTML = "Asking the database…";
      try { await runCloudCheck(); }
      catch (e) { checkOut.innerHTML = escapeHtml(UserStore.explain(e)); }
      finally { checkBtn.disabled = false; checkBtn.textContent = original; }
    });
  }

  /* ---- copy, download, revert ------------------------------------------- */
  document.getElementById("copyBtn").addEventListener("click", async function () {
    try {
      await navigator.clipboard.writeText(generated());
      toast("Copied. Paste it over the USERS array in users.js");
    } catch (e) {
      toast("Clipboard blocked - select the text and copy manually");
    }
  });

  document.getElementById("downloadBtn").addEventListener("click", function () {
    const blob = new Blob([generated()], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "users-array.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById("revertBtn").addEventListener("click", function () {
    working = COMMITTED.map(function (u) { return Object.assign({}, u); });
    dirty = false;
    apply();
    toast("Reverted to the committed registry");
  });

  setBackendBanner();
  showUid();
  render();

  /* If a cloud store is configured, refresh from it so the table shows what
     everyone else sees rather than a stale copy. */
  if (CLOUD) {
    /* hydrate() waits for the persisted Firebase session internally, so the
       UID panel below is populated by the time this resolves. */
    UserStore.hydrate().then(function () {
      working = USER_DB.USERS.map(function (u) { return Object.assign({}, u); });
      setBackendBanner();
      showUid();
      render();
    });
  }
})();

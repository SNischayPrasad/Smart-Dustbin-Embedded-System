/* ==========================================================================
   oauth-ui.js - wires Google Identity Services into the login page
   --------------------------------------------------------------------------
   Deliberately degrades in three steps, because this project has to survive
   a viva on a bad network:

     no Client ID configured  -> the Google block is hidden entirely
     configured but offline   -> a plain message, demo sign-in still works
     configured and online    -> the real button
   ========================================================================== */
(function () {

  const box     = document.getElementById("googleBox");
  const slot    = document.getElementById("googleButton");
  const note    = document.getElementById("googleNote");
  const errBox  = document.getElementById("loginError");

  if (!box) return;

  function showError(msg) {
    errBox.textContent = msg;
    errBox.classList.add("show");
  }
  function setNote(html) { if (note) note.innerHTML = html; }

  /* Cloud problems are worth surfacing but must never block a sign-in that
     the committed registry already permits. */
  function serialWarn(msg) {
    if (window.console) console.warn("[smart-dustbin] " + msg);
  }

  /* ---- 1. not configured: hide the whole block ------------------------ */
  if (!GoogleAuth.isConfigured()) {
    box.classList.add("hidden");
    return;
  }

  /* ---- 2. handle the credential Google hands back --------------------- */
  async function onCredential(response) {
    setNote("Verifying token signature&hellip;");
    try {
      const payload = await GoogleAuth.verifyIdToken(
        response.credential, AUTH_CONFIG.GOOGLE_CLIENT_ID);

      /* If a cloud store is configured, exchange the same verified token
         for a Firebase session and pull the live admin list. The committed
         registry is still the floor, so an unreachable Firebase cannot lock
         the owner out. */
      let firebaseUid = null;
      if (typeof UserStore !== "undefined" && UserStore.configured()) {
        setNote("Signing in to the cloud store&hellip;");
        try {
          const fbUser = await UserStore.signInWithGoogleIdToken(response.credential);
          firebaseUid = fbUser ? fbUser.uid : null;
        } catch (e) {
          /* Surfaced, not swallowed: every failure here is a setup step the
             reader still has to do, and hiding it in the console meant the
             UID panel just said "not signed in" with no reason given. */
          setNote("Signed in with Google, but the cloud store refused: " +
                  UserStore.explain(e));
        }
        try {
          await UserStore.hydrate();
        } catch (e) {
          serialWarn("Could not load the cloud admin list: " + e.message);
        }
      }

      /* Authentication succeeded - Google confirmed who this is.
         Authorisation is a separate question, answered by the registry. */
      const decision = await Users.resolve(payload.email);

      if (!decision.allowed) {
        setNote("");
        showError(payload.email + " is not in the user registry, so it has no " +
                  "access to this console. Signing in with Google worked - you " +
                  "are simply not on the list.");
        if (window.google) google.accounts.id.disableAutoSelect();
        return;
      }

      AUTH.startSession({
        username: payload.email,
        name:     decision.name || payload.name || payload.email,
        email:    payload.email,
        picture:  payload.picture || null,
        role:     decision.role,
        method:   "google",
        uid:      firebaseUid
      });

      window.location.href = "admin.html";

    } catch (err) {
      setNote("");
      showError("Google sign-in rejected: " + err.message);
    }
  }

  /* ---- 3. render the button once the GIS script has loaded ------------ */
  function render() {
    try {
      google.accounts.id.initialize({
        client_id: AUTH_CONFIG.GOOGLE_CLIENT_ID,
        callback: onCredential,
        auto_select: false,
        cancel_on_tap_outside: true
      });
      google.accounts.id.renderButton(slot, {
        theme: "outline", size: "large", shape: "pill",
        text: "signin_with", width: 280, logo_alignment: "center"
      });
      const admins = Users.adminCount();
      setNote(USER_DB.DEFAULT_ROLE_FOR_UNKNOWN === "deny"
        ? "Only registered accounts may sign in &mdash; " + admins +
          " administrator" + (admins === 1 ? "" : "s") + " configured."
        : "Registered accounts get their role; anyone else signs in read-only.");
    } catch (e) {
      box.classList.add("hidden");
    }
  }

  /* GIS is loaded with `defer`, so it may or may not be ready yet. */
  if (window.google && google.accounts && google.accounts.id) {
    render();
  } else {
    let waited = 0;
    const poll = setInterval(function () {
      if (window.google && google.accounts && google.accounts.id) {
        clearInterval(poll);
        render();
      } else if ((waited += 200) >= 6000) {
        clearInterval(poll);
        slot.innerHTML = "";
        setNote("Could not reach Google. Use the demo sign-in below.");
      }
    }, 200);
  }
})();

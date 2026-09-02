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

      /* Authentication succeeded. Authorisation is a separate question. */
      if (!GoogleAuth.isAllowed(payload.email)) {
        setNote("");
        showError(payload.email + " is not on the administrator allowlist.");
        if (window.google) google.accounts.id.disableAutoSelect();
        return;
      }

      AUTH.startSession({
        username: payload.email,
        name:     payload.name || payload.email,
        email:    payload.email,
        picture:  payload.picture || null,
        role:     GoogleAuth.allowlistIsOpen() ? "Guest (open demo)" : "Administrator",
        method:   "google"
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
      setNote(GoogleAuth.allowlistIsOpen()
        ? "Any Google account may sign in - this demo has no allowlist set."
        : "Only allowlisted Google accounts may sign in.");
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

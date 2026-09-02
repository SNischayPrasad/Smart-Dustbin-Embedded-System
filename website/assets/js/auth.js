/* ==========================================================================
   auth.js - admin login for the Smart Dustbin dashboard
   --------------------------------------------------------------------------
   HONEST SECURITY NOTE - read this before you demo the project
   --------------------------------------------------------------------------
   This is a CLIENT-SIDE demo login. The credentials live in the JavaScript
   that the browser downloads, so anybody who opens DevTools can read them.
   That is fine for a college project running from a static folder, and it is
   NOT fine for anything real.

   How the same screen would be built for production:
     1. The browser POSTs the username and password over HTTPS.
     2. The server looks the user up and compares the password against a
        bcrypt / argon2 hash - the plain password is never stored anywhere.
     3. The server returns a signed, http-only, short-lived session cookie
        which JavaScript cannot read, so an XSS bug cannot steal it.
     4. Every /api/* route re-checks that cookie server-side. The front end
        never decides who is allowed in - it only decides what to draw.
     5. Failed attempts are rate-limited per IP and per account.

   server/server.js in this repository contains a small Express version that
   demonstrates step 1, 3 and 4 for anyone who wants to go further.

   GOOGLE SIGN-IN
   --------------------------------------------------------------------------
   oauth.js adds real OAuth 2.0 / OpenID Connect on top of this file. That
   flow is genuine authentication - the ID token's RS256 signature is checked
   against Google's published keys before any session is created. Sessions
   from either route share the shape below, so the rest of the app does not
   care which was used; `session.method` records it.
   ========================================================================== */

const AUTH = (function () {

  /* ---- Demo credentials ----------------------------------------------
     These are printed on the login page and in the README, so anyone can
     use them. They therefore must NOT grant control of the fleet - this
     account signs in with whatever role users.js sets for it, which is
     "viewer" (read-only). Administrator access comes from Google sign-in
     and the user registry.                                              */
  const USERS = [
    { username: "Nischay", password: "Admin@123", name: "Demo visitor" }
  ];

  const SESSION_KEY  = "smartdustbin.session";
  const LOCK_KEY     = "smartdustbin.lockout";
  const SESSION_MINS = 120;     /* auto logout after two hours of a session */
  const MAX_ATTEMPTS = 5;
  const LOCK_MINS    = 1;

  /* ---- Lockout: slows down anyone guessing passwords ----------------- */
  function lockState() {
    try { return JSON.parse(sessionStorage.getItem(LOCK_KEY)) || { fails: 0, until: 0 }; }
    catch (e) { return { fails: 0, until: 0 }; }
  }
  function saveLock(s) {
    try { sessionStorage.setItem(LOCK_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function lockedForSeconds() {
    const s = lockState();
    const remaining = Math.ceil((s.until - Date.now()) / 1000);
    return remaining > 0 ? remaining : 0;
  }

  /* ---- Login --------------------------------------------------------- */
  function login(username, password) {
    const wait = lockedForSeconds();
    if (wait > 0) {
      return { ok: false, message: "Too many attempts. Try again in " + wait + "s." };
    }

    const user = USERS.find(u => u.username === username && u.password === password);

    if (!user) {
      const s = lockState();
      s.fails += 1;
      if (s.fails >= MAX_ATTEMPTS) {
        s.until = Date.now() + LOCK_MINS * 60000;
        s.fails = 0;
        saveLock(s);
        return { ok: false, message: "Too many failed attempts. Locked for " + LOCK_MINS + " minute." };
      }
      saveLock(s);
      const left = MAX_ATTEMPTS - s.fails;
      return { ok: false, message: "Invalid username or password. " + left + " attempt(s) left." };
    }

    saveLock({ fails: 0, until: 0 });

    const demoRole = (typeof USER_DB !== "undefined" && USER_DB.DEMO_LOGIN_ROLE)
                     ? USER_DB.DEMO_LOGIN_ROLE : "viewer";

    return { ok: true, session: startSession({
      username: user.username,
      name:     user.name,
      role:     demoRole,
      method:   "demo"
    }) };
  }

  /* ---- Create a session from any authenticated identity ---------------
     Used by the demo login above and by oauth.js after it has verified a
     Google ID token. Keeping session creation in one place means the
     expiry rules cannot drift between the two routes.                   */
  function startSession(identity) {
    const minutes = (typeof AUTH_CONFIG !== "undefined" && AUTH_CONFIG.SESSION_MINUTES)
                    ? AUTH_CONFIG.SESSION_MINUTES : SESSION_MINS;

    const session = {
      username: identity.username,
      name:     identity.name || identity.username,
      email:    identity.email || null,
      picture:  identity.picture || null,
      role:     identity.role || "viewer",
      method:   identity.method || "demo",
      issued:   Date.now(),
      expires:  Date.now() + minutes * 60000
    };
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {}
    return session;
  }

  /* ---- Session ------------------------------------------------------- */
  function currentSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY));
      if (!s) return null;
      if (Date.now() > s.expires) { logout(); return null; }
      return s;
    } catch (e) { return null; }
  }

  function isLoggedIn() { return currentSession() !== null; }

  function logout() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  /* ---- Route guard ---------------------------------------------------
     Called at the very top of admin.html. If there is no valid session
     the browser is sent to the login page before anything renders.     */
  function requireAuth(loginUrl) {
    if (!isLoggedIn()) {
      window.location.replace(loginUrl || "login.html");
      return false;
    }
    return true;
  }

  return {
    login: login,
    startSession: startSession,
    logout: logout,
    isLoggedIn: isLoggedIn,
    currentSession: currentSession,
    requireAuth: requireAuth,
    lockedForSeconds: lockedForSeconds
  };
})();

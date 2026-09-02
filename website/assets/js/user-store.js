/* ==========================================================================
   user-store.js - where the admin list actually lives
   --------------------------------------------------------------------------
   Two backends behind one interface:

     Firestore   when firebase-config.js is filled in. Changes are instant,
                 shared by everyone, and enforced server-side by Security
                 Rules, so the browser is no longer the thing deciding who
                 may write.

     Committed   otherwise. The registry in users.js, exactly as before.

   The committed registry is ALWAYS loaded, and cloud entries are merged on
   top. That is deliberate: if Firebase is unreachable, misconfigured, or the
   free tier is exhausted, the owner can still sign in from the file in the
   repository. A remote dependency should never be able to lock you out of
   your own project.
   ========================================================================== */

const UserStore = (function () {

  let db = null;
  let ready = false;
  let cloudEntries = null;      /* null = not loaded yet */
  let lastError = null;

  function configured() {
    if (typeof FIREBASE_CONFIG === "undefined") return false;
    const fb = FIREBASE_CONFIG.FIREBASE || {};
    return String(fb.apiKey || "").trim().length > 0 &&
           String(fb.projectId || "").trim().length > 0;
  }

  function sdkPresent() {
    return typeof firebase !== "undefined" &&
           typeof firebase.initializeApp === "function";
  }

  /* ---- start up -------------------------------------------------------- */
  function init() {
    if (ready) return true;
    if (!configured() || !sdkPresent()) return false;
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG.FIREBASE);
      db = firebase.firestore();
      ready = true;
    } catch (e) {
      lastError = e.message;
      ready = false;
    }
    return ready;
  }

  /* ---- exchange the Google ID token for a Firebase session -------------
     The page has already verified this token against Google's public keys.
     Handing the same token to Firebase gives a session that Security Rules
     can reason about, without a second sign-in prompt.                   */
  async function signInWithGoogleIdToken(idToken) {
    if (!init()) return null;
    const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
    const result = await firebase.auth().signInWithCredential(credential);
    return result.user;
  }

  /* A direct Google popup, independent of the page's own sign-in flow.
     This exists to break a chicken-and-egg during setup: the Security Rules
     need the owner's UID, but the UID only exists after a first Firebase
     sign-in. This button produces one without anything else being
     configured. */
  async function signInWithPopup() {
    if (!init()) throw new Error("Firebase is not configured");
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const result = await firebase.auth().signInWithPopup(provider);
    return result.user;
  }

  /* Firebase error codes are precise but the messages are not always
     actionable, so translate the ones that actually come up during setup. */
  function explain(err) {
    const code = (err && err.code) || "";
    switch (code) {
      case "auth/unauthorized-domain":
        return "This domain is not on the Firebase authorised list. " +
               "Firebase console > Authentication > Settings > Authorised " +
               "domains, and add: " + location.hostname;
      case "auth/operation-not-allowed":
        return "Google sign-in is not enabled on the Firebase project. " +
               "Authentication > Sign-in method > enable Google.";
      case "auth/popup-blocked":
        return "The browser blocked the popup. Allow popups for this site " +
               "and try again.";
      case "auth/popup-closed-by-user":
        return "The sign-in window was closed before it finished.";
      case "auth/configuration-not-found":
        return "Authentication is not set up on this Firebase project yet. " +
               "Authentication > Get started.";
      case "permission-denied":
      case "auth/permission-denied":
        return "The database refused this. Publish firestore.rules with your " +
               "owner UID.";
      default:
        return (err && err.message) || String(err);
    }
  }

  function currentUid() {
    if (!ready || !firebase.auth().currentUser) return null;
    return firebase.auth().currentUser.uid;
  }

  /* Firebase restores a persisted session ASYNCHRONOUSLY. Immediately after
     initializeApp, currentUser is still null even for a signed-in user, so
     anything that reads Firestore on page load must wait for the first
     onAuthStateChanged callback or it will be refused by the rules and
     wrongly conclude the cloud is unreachable.

     Resolves with the user, or null if there is genuinely nobody signed in
     (or the callback never arrives). */
  function waitForAuth(timeoutMs) {
    if (!init()) return Promise.resolve(null);
    if (firebase.auth().currentUser) return Promise.resolve(firebase.auth().currentUser);

    return new Promise(function (resolve) {
      let settled = false;
      const finish = function (user) {
        if (settled) return;
        settled = true;
        resolve(user || null);
      };
      const timer = setTimeout(function () { finish(null); }, timeoutMs || 5000);
      const unsub = firebase.auth().onAuthStateChanged(function (user) {
        clearTimeout(timer);
        if (typeof unsub === "function") unsub();
        finish(user);
      });
    });
  }

  function isOwnerUid(uid) {
    const want = String((typeof FIREBASE_CONFIG !== "undefined" && FIREBASE_CONFIG.OWNER_UID) || "").trim();
    return !!want && uid === want;
  }

  /* ---- read ------------------------------------------------------------ */
  async function loadCloud() {
    if (!init()) return [];
    try {
      const snap = await db.collection(FIREBASE_CONFIG.COLLECTION).get();
      cloudEntries = snap.docs.map(function (d) {
        const v = d.data();
        return { id: d.id, emailHash: v.emailHash, name: v.name, role: v.role, source: "cloud" };
      });
      lastError = null;
    } catch (e) {
      lastError = e.message;
      cloudEntries = [];
    }
    return cloudEntries;
  }

  /* Committed entries first, cloud on top. A cloud entry with the same hash
     wins, so the owner can change someone's role without editing the file. */
  function merge(committed, cloud) {
    const out = committed.map(function (u) {
      return Object.assign({ source: "committed" }, u);
    });
    (cloud || []).forEach(function (c) {
      const i = out.findIndex(function (u) {
        return (u.emailHash || "").toLowerCase() === String(c.emailHash || "").toLowerCase();
      });
      if (i === -1) out.push(c);
      else out[i] = Object.assign({}, out[i], c);
    });
    return out;
  }

  /* Loads the cloud list and pushes the merged result into the registry so
     that Users.resolve() sees cloud-added people. */
  async function hydrate() {
    const committed = USER_DB.COMMITTED_USERS || USER_DB.USERS;
    if (!USER_DB.COMMITTED_USERS) {
      USER_DB.COMMITTED_USERS = committed.map(function (u) { return Object.assign({}, u); });
    }
    if (!configured()) {
      USER_DB.USERS = USER_DB.COMMITTED_USERS.slice();
      return { source: "committed", entries: USER_DB.USERS };
    }
    /* Wait for a persisted session before reading, otherwise the rules
       refuse an anonymous request and we fall back for no good reason. */
    await waitForAuth();

    const cloud = await loadCloud();
    USER_DB.USERS = merge(USER_DB.COMMITTED_USERS, cloud);
    return { source: lastError ? "committed (cloud unavailable)" : "cloud", entries: USER_DB.USERS, error: lastError };
  }

  /* ---- write ------------------------------------------------------------
     These calls will simply be refused by Security Rules unless the signed
     in user is the owner. The UI also hides them, but the rule is what
     actually decides.                                                     */
  async function addUser(entry) {
    if (!init()) throw new Error("Cloud store is not configured");
    const doc = {
      emailHash: entry.emailHash,
      name: entry.name,
      role: entry.role,
      addedAt: Date.now(),
      addedBy: currentUid() || "unknown"
    };
    await db.collection(FIREBASE_CONFIG.COLLECTION).doc(entry.emailHash).set(doc);
    return doc;
  }

  async function removeUser(emailHash) {
    if (!init()) throw new Error("Cloud store is not configured");
    await db.collection(FIREBASE_CONFIG.COLLECTION).doc(emailHash).delete();
  }

  return {
    configured: configured,
    sdkPresent: sdkPresent,
    init: init,
    hydrate: hydrate,
    merge: merge,
    loadCloud: loadCloud,
    addUser: addUser,
    removeUser: removeUser,
    signInWithGoogleIdToken: signInWithGoogleIdToken,
    signInWithPopup: signInWithPopup,
    explain: explain,
    waitForAuth: waitForAuth,
    currentUid: currentUid,
    isOwnerUid: isOwnerUid,
    lastError: function () { return lastError; }
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { UserStore };

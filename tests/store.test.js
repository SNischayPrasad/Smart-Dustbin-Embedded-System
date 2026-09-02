/* ==========================================================================
   Tests for user-store.js - the merge between the committed registry and
   the cloud one.  Run:  node tests/store.test.js

   This is the code that decides who gets in once Firestore is switched on,
   so the cases that matter are the awkward ones: cloud overriding a
   committed role, the cloud being unreachable, and the cloud trying to
   remove the owner's own access.
   ========================================================================== */

const fs = require("fs");
const path = require("path");

global.FIREBASE_CONFIG = {
  FIREBASE: { apiKey: "", projectId: "" },
  OWNER_UID: "owner-uid-123",
  COLLECTION: "admins"
};
global.USER_DB = { USERS: [] };

eval(fs.readFileSync(path.join(__dirname, "../website/assets/js/user-store.js"), "utf8")
       .replace("const UserStore", "var UserStore"));

let pass = 0, fail = 0;
function check(name, ok) {
  console.log((ok ? "  PASS  " : "  FAIL  ") + name);
  ok ? pass++ : fail++;
}

const OWNER = { emailHash: "a".repeat(64), name: "Owner",  role: "owner" };
const MATE  = { emailHash: "b".repeat(64), name: "Mate",   role: "admin" };

console.log("\nConfiguration gate");
check("no apiKey means not configured", UserStore.configured() === false);
FIREBASE_CONFIG.FIREBASE = { apiKey: "AIzaFake", projectId: "demo" };
check("apiKey + projectId means configured", UserStore.configured() === true);
FIREBASE_CONFIG.FIREBASE = { apiKey: "AIzaFake", projectId: "" };
check("projectId alone missing is not configured", UserStore.configured() === false);
FIREBASE_CONFIG.FIREBASE = { apiKey: "AIzaFake", projectId: "demo" };

console.log("\nMerging committed and cloud entries");
let m = UserStore.merge([OWNER, MATE], []);
check("empty cloud keeps the committed list", m.length === 2);
check("committed entries are labelled", m.every(u => u.source === "committed"));

m = UserStore.merge([OWNER, MATE], [
  { emailHash: "c".repeat(64), name: "Cloudy", role: "admin", source: "cloud" }
]);
check("a cloud-only person is appended", m.length === 3);
check("the new person is labelled cloud", m[2].source === "cloud");

m = UserStore.merge([OWNER, MATE], [
  { emailHash: "b".repeat(64), name: "Mate", role: "viewer", source: "cloud" }
]);
check("cloud overrides a committed role", m.length === 2 && m[1].role === "viewer");
check("the overridden entry is marked cloud", m[1].source === "cloud");

m = UserStore.merge([OWNER, MATE], [
  { emailHash: "B".repeat(64), name: "Mate", role: "viewer", source: "cloud" }
]);
check("hash matching ignores case, so no duplicate is created", m.length === 2);

console.log("\nThe committed registry is always the floor");
m = UserStore.merge([OWNER], []);
check("owner survives an empty cloud", m.length === 1 && m[0].role === "owner");
m = UserStore.merge([OWNER], null);
check("owner survives a null cloud (Firebase unreachable)", m.length === 1);
check("owner keeps the owner role", m[0].role === "owner");

console.log("\nOwner UID check");
check("the configured owner uid matches", UserStore.isOwnerUid("owner-uid-123") === true);
check("another uid does not",             UserStore.isOwnerUid("someone-else") === false);
check("an empty uid never matches",       UserStore.isOwnerUid("") === false);
FIREBASE_CONFIG.OWNER_UID = "";
check("an unset OWNER_UID matches nobody", UserStore.isOwnerUid("anything") === false);
FIREBASE_CONFIG.OWNER_UID = "owner-uid-123";

console.log("\nWrites refuse to run without configuration");
FIREBASE_CONFIG.FIREBASE = { apiKey: "", projectId: "" };
(async () => {
  try { await UserStore.addUser(OWNER); check("addUser throws when unconfigured", false); }
  catch (e) { check("addUser throws when unconfigured", /not configured/i.test(e.message)); }
  try { await UserStore.removeUser("x"); check("removeUser throws when unconfigured", false); }
  catch (e) { check("removeUser throws when unconfigured", /not configured/i.test(e.message)); }

  /* ------------------------------------------------------------------
     The cloud path, against a stubbed Firestore. This exercises the code
     that runs when Firebase IS configured, including the case that matters
     most: the database refusing a write because Security Rules said no.
     ------------------------------------------------------------------ */
  console.log("\nCloud path (stubbed Firestore)");

  const store = { docs: {} };
  let denyWrites = false;
  let failReads  = false;

  global.firebase = {
    apps: [],
    initializeApp: function () { global.firebase.apps.push({}); },
    auth: Object.assign(function () {
      return { currentUser: { uid: "owner-uid-123" },
               signInWithCredential: async () => ({ user: { uid: "owner-uid-123" } }) };
    }, { GoogleAuthProvider: { credential: t => ({ token: t }) } }),
    firestore: function () {
      return {
        collection: function () {
          return {
            get: async function () {
              /* Checked at call time, so the db handle cached by init() can
                 be made to fail - which is what a real outage looks like. */
              if (failReads) throw new Error("network");
              return { docs: Object.keys(store.docs).map(id => ({ id, data: () => store.docs[id] })) };
            },
            doc: function (id) {
              return {
                set: async function (d) {
                  if (denyWrites) throw new Error("Missing or insufficient permissions.");
                  store.docs[id] = d;
                },
                delete: async function () {
                  if (denyWrites) throw new Error("Missing or insufficient permissions.");
                  delete store.docs[id];
                }
              };
            }
          };
        }
      };
    }
  };

  FIREBASE_CONFIG.FIREBASE = { apiKey: "AIzaFake", projectId: "demo" };
  check("SDK is detected", UserStore.sdkPresent() === true);
  check("init succeeds",   UserStore.init() === true);

  const CLOUDY = { emailHash: "c".repeat(64), name: "Cloudy", role: "admin" };
  await UserStore.addUser(CLOUDY);
  check("addUser writes a document",      Object.keys(store.docs).length === 1);
  check("the document is keyed by hash",  !!store.docs["c".repeat(64)]);
  check("addedBy records the writer",     store.docs["c".repeat(64)].addedBy === "owner-uid-123");
  check("no address stored, only a digest", JSON.stringify(store.docs).indexOf("@") === -1);

  const loaded = await UserStore.loadCloud();
  check("loadCloud returns the entry", loaded.length === 1 && loaded[0].name === "Cloudy");

  global.USER_DB = { USERS: [OWNER] };
  const h = await UserStore.hydrate();
  check("hydrate merges cloud onto committed", USER_DB.USERS.length === 2);
  check("hydrate reports the cloud source",    h.source === "cloud");
  check("the committed owner survives",        USER_DB.USERS.some(u => u.role === "owner"));

  await UserStore.removeUser("c".repeat(64));
  check("removeUser deletes the document", Object.keys(store.docs).length === 0);

  console.log("\nWhen Security Rules refuse the write");
  denyWrites = true;
  try {
    await UserStore.addUser(CLOUDY);
    check("a refused write raises an error", false);
  } catch (e) {
    check("a refused write raises an error", /insufficient permissions/i.test(e.message));
  }
  check("nothing was written", Object.keys(store.docs).length === 0);
  denyWrites = false;

  console.log("\nWhen the cloud is unreachable, the committed registry wins");
  failReads = true;
  global.USER_DB = { USERS: [OWNER] };
  const h2 = await UserStore.hydrate();
  check("hydrate does not throw",            !!h2);
  check("the owner is still present",        USER_DB.USERS.some(u => u.role === "owner"));
  check("the source says cloud unavailable", /unavailable/.test(h2.source));

  console.log("\nwaitForAuth - the persisted-session race");

  failReads = false;
  /* A signed-in user whose session is restored a tick late: currentUser is
     null at first, exactly as Firebase behaves on a real page load. */
  let restored = null;
  let authCb = null;
  global.firebase.auth = Object.assign(function () {
    return {
      get currentUser() { return restored; },
      onAuthStateChanged: function (cb) { authCb = cb; return function () { authCb = null; }; },
      signInWithCredential: async () => ({ user: { uid: "owner-uid-123" } })
    };
  }, { GoogleAuthProvider: { credential: t => ({ token: t }) } });

  const pending = UserStore.waitForAuth(3000);
  setTimeout(function () { restored = { uid: "owner-uid-123" }; if (authCb) authCb(restored); }, 30);
  const gotUser = await pending;
  check("waitForAuth resolves once the session is restored",
        gotUser && gotUser.uid === "owner-uid-123");

  restored = null; authCb = null;
  const noOne = await UserStore.waitForAuth(120);
  check("waitForAuth resolves null when nobody signs in", noOne === null);

  restored = { uid: "already-here" };
  const immediate = await UserStore.waitForAuth(3000);
  check("waitForAuth returns at once if already signed in",
        immediate && immediate.uid === "already-here");

  console.log("\n----------------------------------------");
  console.log("  " + pass + " passed, " + fail + " failed");
  console.log("----------------------------------------\n");
  process.exit(fail ? 1 : 0);
})();

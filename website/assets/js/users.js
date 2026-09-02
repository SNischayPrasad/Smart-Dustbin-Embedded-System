/* ==========================================================================
   users.js - the user registry
   --------------------------------------------------------------------------
   Who may sign in, and what each person is allowed to do.

   WHY THIS IS A FILE AND NOT A DATABASE
   A real fleet console keeps users in a database behind an API, and the
   SERVER decides what each request may do. This site is static - GitHub
   Pages runs no server - so the registry ships as data with the page and the
   checks happen in the browser. That is the correct shape for a static host
   and it is genuinely useful, but be clear about what it is: it decides what
   the UI OFFERS, not what a determined person can do. See the honest-limits
   note at the bottom.

   server/server.js shows where this table belongs in a real deployment.

   WHY THE ADDRESS IS STORED AS A HASH
   This repository is public. Committing a personal Gmail address in plain
   text hands it to every scraper that walks GitHub. Storing the SHA-256 of
   the lowercased address keeps the check working - sign in, hash what Google
   returns, compare - while the address itself never appears in the repo.

   To be plain about what that does and does not achieve: it is NOT
   encryption and NOT a security control. Anyone who guesses the address can
   hash it and confirm the match. It defeats bulk harvesting, which is the
   realistic risk here, and nothing more.

   Both forms work, so use whichever you prefer:
       { email:     "you@gmail.com",  ... }   plain text, readable
       { emailHash: "007dda63...",    ... }   hashed, not harvestable
   ========================================================================== */

const USER_DB = {

  /* ---- What each role may do ------------------------------------------ */
  ROLES: {
    admin: {
      label: "Administrator",
      description: "Full control of every bin in the fleet",
      canControlBins: true,     /* open / close / mute / mark collected */
      canBulkAct:     true,     /* fleet-wide commands, e.g. mute all    */
      canPlanRoute:   true,     /* compute a collection route            */
      canResetDemo:   true
    },
    viewer: {
      label: "Viewer",
      description: "Can see the fleet, cannot change anything",
      canControlBins: false,
      canBulkAct:     false,
      /* Route planning only reads the fleet and prints a list, so a viewer
         may do it - it is the most interesting thing to show a visitor. */
      canPlanRoute:   true,
      canResetDemo:   false
    }
  },

  /* ---- The people ------------------------------------------------------
     Add a row per person. `email` or `emailHash`, plus a name and a role.

     The entry below is the owner of this project. The hash is the SHA-256
     of the lowercased address; generate your own with:

         node tools/hash-email.js someone@example.com
  ------------------------------------------------------------------------ */
  USERS: [
    {
      emailHash: "007dda63f0cb9774705083417edbff84332b237f6c480330df303865e60efc87",
      name: "Nischay",
      role: "admin"
    }

    /* Example of a second person, in plain text:
    ,{ email: "teammate@gmail.com", name: "Teammate", role: "viewer" }
    */
  ],

  /* ---- Anyone not in the table above -----------------------------------
     "deny"   - refuse the sign-in outright (the strict choice)
     "viewer" - let them in read-only, which keeps the public demo usable
     Set to "deny" if you want the site locked to the table above.        */
  DEFAULT_ROLE_FOR_UNKNOWN: "deny",

  /* The demo username/password on the login page is public, so it must not
     grant control. It signs in as a viewer. */
  DEMO_LOGIN_ROLE: "viewer"
};

/* ==========================================================================
   Lookup
   ========================================================================== */
const Users = (function () {

  function normalise(email) {
    return String(email || "").trim().toLowerCase();
  }

  async function sha256Hex(text) {
    const subtle = self.crypto && self.crypto.subtle;
    if (!subtle) throw new Error("WebCrypto unavailable - serve over HTTPS or localhost");
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, "0")).join("");
  }

  /* Returns the matching user record, or null. Compares plain-text entries
     first because that needs no hashing, then hashes once for the rest. */
  async function find(email) {
    const wanted = normalise(email);
    if (!wanted) return null;

    const plain = USER_DB.USERS.find(u => u.email && normalise(u.email) === wanted);
    if (plain) return plain;

    if (USER_DB.USERS.some(u => u.emailHash)) {
      const hash = await sha256Hex(wanted);
      const hashed = USER_DB.USERS.find(u => u.emailHash &&
        String(u.emailHash).toLowerCase() === hash);
      if (hashed) return hashed;
    }
    return null;
  }

  /* The decision the login page acts on. */
  async function resolve(email) {
    const user = await find(email);

    if (user) {
      return { allowed: true, role: user.role, name: user.name, known: true };
    }
    if (USER_DB.DEFAULT_ROLE_FOR_UNKNOWN === "deny") {
      return { allowed: false, role: null, known: false };
    }
    return { allowed: true, role: USER_DB.DEFAULT_ROLE_FOR_UNKNOWN, known: false };
  }

  function permissions(role) {
    return USER_DB.ROLES[role] || USER_DB.ROLES.viewer;
  }

  function roleLabel(role) {
    const r = USER_DB.ROLES[role];
    return r ? r.label : "Viewer";
  }

  function adminCount() {
    return USER_DB.USERS.filter(u => u.role === "admin").length;
  }

  return {
    find: find, resolve: resolve, permissions: permissions,
    roleLabel: roleLabel, adminCount: adminCount,
    sha256Hex: sha256Hex, normalise: normalise
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { USER_DB, Users };

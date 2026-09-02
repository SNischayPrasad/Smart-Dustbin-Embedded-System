/* ==========================================================================
   firebase-config.js - optional cloud store for the admin list
   --------------------------------------------------------------------------
   Leave this empty and nothing changes: the site keeps using the registry
   committed in users.js, exactly as before. Fill it in and the admin list
   moves to Firestore, where changes are instant, shared by everyone, and
   survive without touching the repository.

   WHY THIS IS THE INTERESTING UPGRADE
   Until now every access check ran in the browser, so it decided what the UI
   offered rather than what a determined person could do. Firestore Security
   Rules run on Google's servers. Once the rule below is in place, an
   attacker editing localStorage or calling the API by hand still cannot add
   an administrator, because the write is refused server-side. That is the
   difference between a UI convention and actual authorisation.

   ---------------------------------------------------------------------------
   SETUP (about five minutes, free, no card)

   1. https://console.firebase.google.com/ -> Add project.
      Use the SAME Google project as your OAuth Client ID if you like; it is
      not required.

   2. Build > Authentication > Get started > Sign-in method
      Enable "Google". Save.

   3. Build > Firestore Database > Create database
      Start in PRODUCTION mode, pick any region.

   4. Project settings (gear) > General > Your apps > Web app (</>)
      Register the app, then copy the firebaseConfig values into FIREBASE
      below. These values are PUBLIC by design - they identify the project,
      they do not authorise anything. The Security Rules do that.

   5. Sign in once on this site. Then in
      Authentication > Users, copy your User UID and paste it into
      OWNER_UID below. A UID is an opaque identifier, safe to commit, and
      unlike an email address it reveals nothing.

   6. Firestore Database > Rules, paste the contents of firestore.rules
      from the repository root, replacing OWNER_UID_HERE with the same UID.
      Publish.

   That last step is the one that matters. Without it the database is open
   and anyone could add themselves.
   ========================================================================== */

const FIREBASE_CONFIG = {

  /* Paste from Firebase console > Project settings > Your apps.
     Leave apiKey empty to keep using the committed registry. */
  FIREBASE: {
    apiKey:            "",
    authDomain:        "",
    projectId:         "",
    storageBucket:     "",
    messagingSenderId: "",
    appId:             ""
  },

  /* The Firebase UID of the owner - the only account allowed to change the
     admin list. Must match the UID in firestore.rules. */
  OWNER_UID: "",

  /* Firestore collection holding the admin list. */
  COLLECTION: "admins"
};

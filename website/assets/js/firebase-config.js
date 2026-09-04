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

   2b. Authentication > Settings > Authorised domains > Add domain
      Add:  snischayprasad.github.io
      localhost is already there by default. Firebase refuses to complete a
      sign-in from a domain that is not on this list, and the resulting
      error mentions the domain rather than the setting, so it is an easy
      half hour to lose.

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

   Steps 2b and 6 are the ones people miss. Without 2b the sign-in fails on
   the live site; without 6 the database is either shut (production mode) or
   open to the world (test mode).

   IF YOU CHOSE "TEST MODE" FOR FIRESTORE
   Test mode allows anyone to read and write your database for 30 days. Do
   not leave it that way - publish firestore.rules now.
   ========================================================================== */

const FIREBASE_CONFIG = {

  /* Paste from Firebase console > Project settings > Your apps.
     Leave apiKey empty to keep using the committed registry. */
  FIREBASE: {
    apiKey:            "AIzaSyDR7IGdS2Br7u_2iLALcS3hgRCiDFtZtGI",
    authDomain:        "sdbs-399da.firebaseapp.com",
    projectId:         "sdbs-399da",
    storageBucket:     "sdbs-399da.firebasestorage.app",
    messagingSenderId: "1096542049483",
    appId:             "1:1096542049483:web:4e17e89454bf6840e3374e"
    /* measurementId is for Google Analytics, which this project does not
       load, so it is left out rather than kept as dead configuration. */
  },

  /* Firebase UIDs allowed to change the admin list. Must match the list in
     firestore.rules - the rules are what actually enforce this; the entry
     here only decides what the page offers.

     A person gets a UID the first time they sign in to Firebase, so to add
     an owner: have them open users.html, press "Connect to Firebase", copy
     the UID it shows, then add it to BOTH this array and firestore.rules. */
  OWNER_UIDS: [
    "LQQbMKRso0bpYoGlEgI9dJ48R3x2"    /* Nischay */
    /* , "..."                            Nandini - awaiting her first
                                          Firebase sign-in */
  ],

  /* Kept so older code and docs referring to a single owner still work. */
  OWNER_UID: "LQQbMKRso0bpYoGlEgI9dJ48R3x2",

  /* Firestore collection holding the admin list. */
  COLLECTION: "admins"
};

/* ==========================================================================
   auth-config.js - the only file you need to edit to turn on Google sign-in
   --------------------------------------------------------------------------
   HOW TO GET A CLIENT ID (about two minutes, free, no card)

     1. Open  https://console.cloud.google.com/
     2. Create a project (any name, e.g. "Smart Dustbin").
     3. Go to  APIs & Services > OAuth consent screen
          User type: External   ->  Create
          App name, your email for support and developer contact  ->  Save
          (You can leave it in "Testing" mode. While in Testing, only the
           accounts you add under "Test users" are allowed to sign in, which
           is a perfectly good allowlist on its own.)
     4. Go to  APIs & Services > Credentials
          Create credentials > OAuth client ID > Web application
     5. Under "Authorised JavaScript origins" add BOTH of these:
          https://snischayprasad.github.io
          http://localhost:3000
     6. Click Create and copy the Client ID. It looks like
          1234567890-abcdefghijklmnop.apps.googleusercontent.com
     7. Paste it below and commit. 

   IS THE CLIENT ID A SECRET?  No. It is a public identifier and is meant to
   ship in front-end code - that is why this flow needs no client secret and
   works on a static host. The value that IS secret is the "client secret" on
   that same Google page: this project never uses it, and you must never
   commit it. Anything in this repository is public forever.
   ========================================================================== */

const AUTH_CONFIG = {

  /* Paste your Client ID here. Leave it empty and the site simply keeps
     using the demo sign-in - nothing breaks. */
  GOOGLE_CLIENT_ID: "",

  /* WHO MAY SIGN IN is not configured here - it lives in users.js, which
     holds the user registry with names, roles and permissions.           */

  /* Google's public signing keys. The ID token's signature is checked
     against these in the browser using WebCrypto. */
  GOOGLE_JWKS_URL: "https://www.googleapis.com/oauth2/v3/certs",

  /* Accepted `iss` values for a Google ID token. */
  GOOGLE_ISSUERS: ["https://accounts.google.com", "accounts.google.com"],

  /* How long a signed-in session lasts before it expires, in minutes. */
  SESSION_MINUTES: 120
};

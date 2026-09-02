/* ==========================================================================
   oauth.js - Sign in with Google (OAuth 2.0 / OpenID Connect)
   --------------------------------------------------------------------------
   WHY THIS FLOW, ON A STATIC SITE

   The classic OAuth Authorization Code flow exchanges a code for a token at
   the provider's token endpoint, authenticated with a CLIENT SECRET. A secret
   cannot live in front-end code - anyone can read it - so that flow needs a
   server. This project is hosted on GitHub Pages, which has no server.

   Google Identity Services solves that with an OpenID Connect flow for
   PUBLIC clients. Google authenticates the user itself and hands the page a
   signed ID TOKEN: a JWT whose signature only Google can produce. No secret
   is involved, because possession of the token is not what proves anything -
   the SIGNATURE is.

   WHAT MOST TUTORIALS SKIP

   Plenty of examples decode the JWT payload with atob() and trust whatever
   is inside. That is not authentication: a JWT is three base64url strings,
   and anyone can craft one claiming to be anybody. The payload is only
   meaningful once you have verified the signature against Google's published
   public keys, and then checked the claims.

   This file does the real thing:
     1. Fetch Google's JWKS (its public signing keys).
     2. Pick the key whose `kid` matches the token header.
     3. Verify the RS256 signature with WebCrypto.
     4. Validate `iss`, `aud`, `exp`, `nbf` and `email_verified`.
   Any failure is rejected with a specific reason.

   HONEST LIMITS - say these out loud in a viva

   Verifying in the browser proves the token is genuinely Google's. It does
   NOT make this dashboard secure, because there is no server and no
   protected API: the fleet lives in localStorage, so anyone can edit it from
   DevTools regardless of who signed in. Real authorisation requires the
   SERVER to verify the token on every request - which is exactly what
   server/server.js demonstrates. This is real authentication in front of a
   client-side app, and that distinction is the interesting part.
   ========================================================================== */

const GoogleAuth = (function () {

  /* ---- base64url helpers ---------------------------------------------- */

  function b64urlToBytes(str) {
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* Names and emails can contain non-ASCII, so decode as UTF-8 rather than
     relying on atob's latin1 output. */
  function b64urlToString(str) {
    return new TextDecoder().decode(b64urlToBytes(str));
  }

  /* ---- JWKS ------------------------------------------------------------ */

  let jwksCache = null;

  async function defaultFetchJwks() {
    if (jwksCache) return jwksCache;
    const res = await fetch(AUTH_CONFIG.GOOGLE_JWKS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not fetch Google's signing keys (HTTP " + res.status + ")");
    jwksCache = await res.json();
    return jwksCache;
  }

  /* ---- the verifier ----------------------------------------------------
     Exposed separately from the UI so it can be unit tested against a
     locally generated key pair - see tests/oauth.test.js.               */

  async function verifyIdToken(token, clientId, options) {
    options = options || {};
    const fetchJwks = options.fetchJwks || defaultFetchJwks;
    const now       = options.now || Math.floor(Date.now() / 1000);
    const subtle    = (options.subtle) || (self.crypto && self.crypto.subtle);

    if (!subtle) {
      throw new Error("WebCrypto is unavailable - this page must be served over HTTPS or from localhost");
    }

    const parts = String(token).split(".");
    if (parts.length !== 3) throw new Error("Malformed token: expected three segments");

    const [encHeader, encPayload, encSignature] = parts;

    let header, payload;
    try {
      header  = JSON.parse(b64urlToString(encHeader));
      payload = JSON.parse(b64urlToString(encPayload));
    } catch (e) {
      throw new Error("Malformed token: header or payload is not valid JSON");
    }

    /* Refuse anything that is not RS256. A token claiming alg:"none" is the
       textbook JWT forgery, and it must be rejected before any other work. */
    if (header.alg !== "RS256") {
      throw new Error('Unsupported algorithm "' + header.alg + '" - only RS256 is accepted');
    }

    const jwks = await fetchJwks();
    const jwk  = (jwks.keys || []).find(k => k.kid === header.kid);
    if (!jwk) throw new Error("No Google signing key matches this token's key id");

    /* Import only the fields WebCrypto needs; extra JWK members such as
       `use` can cause importKey to reject the key in some browsers. */
    const key = await subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signed   = new TextEncoder().encode(encHeader + "." + encPayload);
    const signature = b64urlToBytes(encSignature);

    const signatureOk = await subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed);
    if (!signatureOk) throw new Error("Signature is not valid - this token was not issued by Google");

    /* ---- claims. A valid signature over the wrong claims is still a
       rejection: an ID token minted for a different app would verify. ---- */

    if (AUTH_CONFIG.GOOGLE_ISSUERS.indexOf(payload.iss) === -1) {
      throw new Error('Unexpected issuer "' + payload.iss + '"');
    }
    if (payload.aud !== clientId) {
      throw new Error("This token was issued for a different application");
    }
    if (typeof payload.exp !== "number" || payload.exp <= now) {
      throw new Error("Token has expired");
    }
    if (typeof payload.nbf === "number" && payload.nbf > now + 60) {
      throw new Error("Token is not valid yet");
    }
    if (payload.email && payload.email_verified === false) {
      throw new Error("This Google account has no verified email address");
    }

    return payload;
  }

  /* Authorisation - who may sign in and with what role - is deliberately
     NOT here. This file answers only "is this token genuinely Google's?".
     users.js answers "and is this person allowed in?". Keeping the two
     apart is the whole distinction between authentication and
     authorisation, and it makes each testable on its own.               */

  function isConfigured() {
    return !!(AUTH_CONFIG.GOOGLE_CLIENT_ID && AUTH_CONFIG.GOOGLE_CLIENT_ID.trim());
  }

  return {
    verifyIdToken: verifyIdToken,
    isConfigured: isConfigured,
    _b64urlToString: b64urlToString
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { GoogleAuth };

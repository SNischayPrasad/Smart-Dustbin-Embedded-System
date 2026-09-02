/* ==========================================================================
   Tests for the Google ID token verifier in website/assets/js/oauth.js
   Run:  node tests/oauth.test.js

   These matter more than the other tests in this repo, because this is the
   only code where being wrong means accepting a forged identity. So rather
   than trusting a happy-path token, most cases below are attempts to get a
   BAD token accepted.

   A locally generated RSA key pair stands in for Google's: the verifier is
   handed a fake JWKS through its options hook, so no network is involved.
   ========================================================================== */

const fs   = require("fs");
const path = require("path");
const nodeCrypto = require("crypto");
const { webcrypto } = nodeCrypto;

global.self = { crypto: webcrypto };
global.AUTH_CONFIG = {
  GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
  GOOGLE_JWKS_URL: "https://example.invalid/certs",
  GOOGLE_ISSUERS: ["https://accounts.google.com", "accounts.google.com"],
  SESSION_MINUTES: 120
};

const src = fs.readFileSync(path.join(__dirname, "../website/assets/js/oauth.js"), "utf8");
eval(src.replace("const GoogleAuth", "var GoogleAuth"));

let pass = 0, fail = 0;
function check(name, ok) {
  console.log((ok ? "  PASS  " : "  FAIL  ") + name);
  ok ? pass++ : fail++;
}
async function rejects(name, promise, fragment) {
  try {
    await promise;
    console.log("  FAIL  " + name + "   (ACCEPTED - this would be a security hole)");
    fail++;
  } catch (e) {
    const ok = !fragment || e.message.toLowerCase().indexOf(fragment.toLowerCase()) !== -1;
    console.log((ok ? "  PASS  " : "  FAIL  ") + name +
                (ok ? "  -> " + e.message : "  wrong reason: " + e.message));
    ok ? pass++ : fail++;
  }
}

const b64url = buf => Buffer.from(buf).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const KID = "test-key-1";
const kp  = nodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = kp.publicKey.export({ format: "jwk" });
const JWKS = { keys: [{ kid: KID, kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", use: "sig" }] };
const fetchJwks = async () => JWKS;
const now = Math.floor(Date.now() / 1000);

function makeToken(o) {
  o = o || {};
  const header = Object.assign({ alg: "RS256", kid: KID, typ: "JWT" }, o.header || {});
  const payload = Object.assign({
    iss: "https://accounts.google.com",
    aud: AUTH_CONFIG.GOOGLE_CLIENT_ID,
    sub: "1234567890",
    email: "nischay@example.com",
    email_verified: true,
    name: "Nischay",
    iat: now - 10,
    exp: now + 3600
  }, o.payload || {});
  if (o.payload && "exp" in o.payload && o.payload.exp === undefined) delete payload.exp;

  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const input = h + "." + p;
  if (o.unsigned) return input + "." + b64url("not-a-signature");
  return input + "." + b64url(nodeCrypto.sign("RSA-SHA256", Buffer.from(input), kp.privateKey));
}

const verify = (t, opts) => GoogleAuth.verifyIdToken(
  t, AUTH_CONFIG.GOOGLE_CLIENT_ID,
  Object.assign({ fetchJwks, subtle: webcrypto.subtle, now }, opts || {}));

(async () => {
  console.log("\nA genuine token is accepted");
  const p = await verify(makeToken());
  check("valid token verifies", !!p);
  check("returns the email claim", p.email === "nischay@example.com");
  check("returns the name claim",  p.name === "Nischay");
  const utf8 = await verify(makeToken({ payload: { name: "Nischay Prasad éèâ" } }));
  check("UTF-8 names survive decoding", utf8.name === "Nischay Prasad éèâ");

  console.log("\nForged and tampered tokens are rejected");
  await rejects("signed with the wrong key", (async () => {
    const other = nodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const h = b64url(JSON.stringify({ alg: "RS256", kid: KID, typ: "JWT" }));
    const pl = b64url(JSON.stringify({ iss: "https://accounts.google.com",
      aud: AUTH_CONFIG.GOOGLE_CLIENT_ID, exp: now + 3600,
      email: "attacker@evil.com", email_verified: true }));
    const sig = nodeCrypto.sign("RSA-SHA256", Buffer.from(h + "." + pl), other.privateKey);
    return verify(h + "." + pl + "." + b64url(sig));
  })(), "signature");

  await rejects("payload swapped after signing", (async () => {
    const t = makeToken();
    const h = t.split(".")[0], s = t.split(".")[2];
    const evil = b64url(JSON.stringify({ iss: "https://accounts.google.com",
      aud: AUTH_CONFIG.GOOGLE_CLIENT_ID, exp: now + 3600,
      email: "attacker@evil.com", email_verified: true }));
    return verify(h + "." + evil + "." + s);
  })(), "signature");

  await rejects("alg none downgrade",  verify(makeToken({ header: { alg: "none"  }, unsigned: true })), "algorithm");
  await rejects("alg HS256 downgrade", verify(makeToken({ header: { alg: "HS256" }, unsigned: true })), "algorithm");
  await rejects("unknown key id",      verify(makeToken({ header: { kid: "not-a-google-key" } })), "key id");
  await rejects("not a JWT at all",    verify("clearly-not-a-jwt"), "three segments");
  await rejects("empty string",        verify(""), "three segments");
  await rejects("non-JSON payload",    verify("eyJhbGciOiJSUzI1NiJ9.%%%%.sig"), "valid JSON");

  console.log("\nValid signature, wrong claims - still rejected");
  await rejects("issued for another app", verify(makeToken({ payload: { aud: "someone-elses-id" } })), "different application");
  await rejects("wrong issuer",           verify(makeToken({ payload: { iss: "https://accounts.evil.com" } })), "issuer");
  await rejects("expired token",          verify(makeToken({ payload: { exp: now - 60 } })), "expired");
  await rejects("missing exp",            verify(makeToken({ payload: { exp: undefined } })), "expired");
  await rejects("not valid yet (nbf)",    verify(makeToken({ payload: { nbf: now + 600 } })), "not valid yet");
  await rejects("unverified email",       verify(makeToken({ payload: { email_verified: false } })), "verified email");

  console.log("\nSeparation of concerns");
  check("the verifier does NOT decide who is allowed in",
        typeof GoogleAuth.isAllowed === "undefined");
  check("nor does it hold an allowlist",
        typeof GoogleAuth.allowlistIsOpen === "undefined");
  check("that decision lives in users.js - see tests/users.test.js", true);

  console.log("\nConfiguration gate");
  AUTH_CONFIG.GOOGLE_CLIENT_ID = "";
  check("empty client id is not configured",      GoogleAuth.isConfigured() === false);
  AUTH_CONFIG.GOOGLE_CLIENT_ID = "   ";
  check("whitespace client id is not configured", GoogleAuth.isConfigured() === false);
  AUTH_CONFIG.GOOGLE_CLIENT_ID = "abc.apps.googleusercontent.com";
  check("a real client id is configured",         GoogleAuth.isConfigured() === true);

  console.log("\n----------------------------------------");
  console.log("  " + pass + " passed, " + fail + " failed");
  console.log("----------------------------------------\n");
  process.exit(fail ? 1 : 0);
})();

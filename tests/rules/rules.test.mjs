/* ==========================================================================
   Firestore Security Rules tests - the server side of the access control.

     cd tests/rules && npm install        (once)
     npm test

   WHY THESE EXIST
   Every other test in this project checks what the BROWSER does. These check
   what Google's servers do, which is the only thing an attacker cannot edit.
   A rules file compiles happily while quietly allowing the whole world to
   write, or quietly refusing the one account that matters, so "it published
   without an error" tells you almost nothing. Each case below is a sentence
   from the spec turned into a request that must be allowed or refused.

   HOW THE EMPTY LISTS ARE HANDLED
   The committed rules ship with collectorUids() = [] and deviceBins() = {},
   because the crew and device accounts do not exist until the owner creates
   them. So the suite runs the rules TWICE:

     "as committed"  - the file exactly as it is published. Proves the empty
                       lists refuse everybody, which is what an empty
                       allow-list must do.
     "wired up"      - the same file with test UIDs substituted into those two
                       functions, so the crew and device rules themselves can
                       be exercised. The substitution is a plain string
                       replacement over the real file: nothing else changes,
                       so a rule that passes here is the rule that ships.
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';

import {
  doc, getDoc, setDoc, deleteDoc, updateDoc,
  collection, getDocs, query, orderBy, limit,
  serverTimestamp, Timestamp,
} from 'firebase/firestore';

const HERE       = dirname(fileURLToPath(import.meta.url));
const RULES_FILE = join(HERE, '../../firestore.rules');
const RULES      = readFileSync(RULES_FILE, 'utf8');

const [envHost, envPort] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
const HOST = envHost || '127.0.0.1';
const PORT = Number(envPort || 8085);

/* The two owner UIDs are read out of the rules themselves, so this suite
   cannot drift from the file it is testing. */
const OWNER_UIDS = [...RULES.matchAll(/'([A-Za-z0-9]{20,40})'/g)]
  .map((m) => m[1])
  .slice(0, 2);
if (OWNER_UIDS.length !== 2) throw new Error('could not read ownerUids() out of firestore.rules');
const OWNER_UID = OWNER_UIDS[0];

const CREW_UID   = 'crew-uid-for-tests-0001';
const DEVICE_UID = 'device-uid-for-tests-01';
const DEVICE_BIN = 'BIN-007';

/* The same digest users.html computes: SHA-256 of the lowercased address,
   lowercase hex. If the rules' hashing.sha256(...).toHexString().lower()
   did not agree with this, every administrator would be refused - which is
   precisely the assumption the "admin" cases below prove. */
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const ADMIN_EMAIL   = 'Admin.Person@Example.COM';
const VIEWER_EMAIL  = 'viewer.person@example.com';
const STRANGER_MAIL = 'nobody@example.com';

/* Substitute test UIDs into the two allow-lists that ship empty. */
const WIRED_RULES = RULES
  .replace(/function collectorUids\(\) \{\s*return \[\];\s*\}/,
           `function collectorUids() { return ['${CREW_UID}']; }`)
  .replace(/function deviceBins\(\) \{\s*return \{\};\s*\}/,
           `function deviceBins() { return { '${DEVICE_UID}': '${DEVICE_BIN}' }; }`);

if (WIRED_RULES === RULES) {
  throw new Error('could not substitute collectorUids()/deviceBins() - has the rules file changed shape?');
}

/* ---- scoring, in the same shape as the other test files ---------------- */
let pass = 0, fail = 0;
function ok(name)        { console.log('  PASS  ' + name); pass++; }
function bad(name, why)  { console.log('  FAIL  ' + name + (why ? '  <- ' + why : '')); fail++; }

async function allow(name, p) {
  try { await assertSucceeds(p); ok(name); }
  catch (e) { bad(name, 'was refused: ' + String(e.message).split('\n')[0]); }
}
async function deny(name, p) {
  try { await assertFails(p); ok(name); }
  catch (e) { bad(name, 'was ALLOWED (it must not be)'); }
}

/* ---- environments ------------------------------------------------------ */
async function makeEnv(rules) {
  return initializeTestEnvironment({
    projectId: 'demo-sdbs',
    firestore: { rules, host: HOST, port: PORT },
  });
}

/* Token shapes. Note what is NOT here: no context is trusted for merely
   being signed in, so every one of these is either on a UID list or carries
   a verified address the registry already knows. */
const asOwner     = (env) => env.authenticatedContext(OWNER_UID,  { email: 'owner@example.com', email_verified: true });
const asAdmin     = (env) => env.authenticatedContext('admin-uid', { email: ADMIN_EMAIL,   email_verified: true });
const asAdminUnv  = (env) => env.authenticatedContext('admin-uid', { email: ADMIN_EMAIL,   email_verified: false });
const asViewer    = (env) => env.authenticatedContext('viewer-uid', { email: VIEWER_EMAIL, email_verified: true });
const asStranger  = (env) => env.authenticatedContext('stranger-uid', { email: STRANGER_MAIL, email_verified: true });
const asAnon      = (env) => env.authenticatedContext('anon-uid', {});          /* no email claim at all */
const asCrew      = (env) => env.authenticatedContext(CREW_UID,   { email: 'crew@example.com', email_verified: true });
const asDevice    = (env) => env.authenticatedContext(DEVICE_UID, { email: 'device@example.com', email_verified: true });
const asPublic    = (env) => env.unauthenticatedContext();

/* Seed the admin registry with the rules switched off - exactly as the owner
   console would have written it, but without needing a rules pass to do it. */
async function seedRegistry(env) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'admins', sha256(ADMIN_EMAIL.toLowerCase())),
                 { emailHash: sha256(ADMIN_EMAIL.toLowerCase()), name: 'Admin Person', role: 'admin' });
    await setDoc(doc(db, 'admins', sha256(VIEWER_EMAIL.toLowerCase())),
                 { emailHash: sha256(VIEWER_EMAIL.toLowerCase()), name: 'Viewer Person', role: 'viewer' });
  });
}

async function seedBin(env, id) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'bins', id), { muted: false, updatedAt: Timestamp.now() });
  });
}

const ts        = () => serverTimestamp();
const backdated = () => Timestamp.fromMillis(Date.now() - 3600_000);
const cmd = (name, extra) => Object.assign(
  { cmd: name, id: 'cmd-1234', at: serverTimestamp(), byRole: 'admin' }, extra || {});

const bins   = (ctx, id) => doc(ctx.firestore(), 'bins', id);
const events = (ctx)     => collection(ctx.firestore(), 'events');

const validEvent = (uid, extra) => Object.assign({
  t: serverTimestamp(), binId: 'BIN-001', msg: 'Marked as collected',
  level: 'success', by: 'Crew - Ravi', uid,
}, extra || {});

/* ======================================================================== */
async function run() {
  /* ====================================================================
     PART 1 - the rules exactly as committed
     ==================================================================== */
  let env = await makeEnv(RULES);
  await env.clearFirestore();
  await seedRegistry(env);

  console.log('\nPublic access to the bin map (no sign-in)');
  await allow('anyone may read one bin',      getDoc(bins(asPublic(env), 'BIN-001')));
  await allow('anyone may list every bin',    getDocs(collection(asPublic(env).firestore(), 'bins')));
  await deny ('but not write one',            setDoc(bins(asPublic(env), 'BIN-001'), { muted: true, updatedAt: ts() }, { merge: true }));
  await deny ('and not delete one',           deleteDoc(bins(asPublic(env), 'BIN-001')));

  console.log('\nBeing signed in is not a privilege (anonymous accounts)');
  await allow('an anonymous user may still read the public map', getDoc(bins(asAnon(env), 'BIN-001')));
  await deny ('an anonymous user may not write a bin',  setDoc(bins(asAnon(env), 'BIN-001'), { muted: true, updatedAt: ts() }, { merge: true }));
  await deny ('an anonymous user may not read admins',  getDoc(doc(asAnon(env).firestore(), 'admins', sha256(ADMIN_EMAIL.toLowerCase()))));
  await deny ('an anonymous user may not read events',  getDocs(events(asAnon(env))));
  await deny ('an anonymous user may not write an event', setDoc(doc(events(asAnon(env))), validEvent('anon-uid')));

  console.log('\nThe owner runs the fleet');
  await allow('owner sets every staff field at once',
    setDoc(bins(asOwner(env), 'BIN-001'), {
      collectedAt: ts(), collectedByRole: 'owner', manual: true, lidOverride: 'OPEN',
      muted: true, online: true, command: cmd('OPEN', { byRole: 'owner' }), updatedAt: ts(),
    }, { merge: true }));
  await allow('owner clears the lid override with null',
    setDoc(bins(asOwner(env), 'BIN-002'), { manual: false, lidOverride: null, updatedAt: ts() }, { merge: true }));
  await allow('owner may delete a bin document', deleteDoc(bins(asOwner(env), 'BIN-002')));

  console.log('\n...but only within the shape the spec allows');
  await deny ('a write with no updatedAt is refused',
    setDoc(bins(asOwner(env), 'BIN-003'), { muted: true }, { merge: true }));
  await deny ('a client-clock updatedAt is refused',
    setDoc(bins(asOwner(env), 'BIN-003'), { muted: true, updatedAt: backdated() }, { merge: true }));
  await deny ('a backdated collectedAt is refused',
    setDoc(bins(asOwner(env), 'BIN-003'), { collectedAt: backdated(), collectedByRole: 'owner', updatedAt: ts() }, { merge: true }));
  await deny ('staff may not sign a collection off as the crew',
    setDoc(bins(asOwner(env), 'BIN-003'), { collectedAt: ts(), collectedByRole: 'crew', updatedAt: ts() }, { merge: true }));
  await deny ('an invented lid state is refused',
    setDoc(bins(asOwner(env), 'BIN-003'), { manual: true, lidOverride: 'AJAR', updatedAt: ts() }, { merge: true }));
  await deny ('a boolean field sent as a string is refused',
    setDoc(bins(asOwner(env), 'BIN-003'), { muted: 'yes', updatedAt: ts() }, { merge: true }));
  await deny ('an unknown top-level field is refused',
    setDoc(bins(asOwner(env), 'BIN-003'), { nickname: 'Binny', updatedAt: ts() }, { merge: true }));
  await deny ('a command with a stray key is refused',
    setDoc(bins(asOwner(env), 'BIN-003'), { command: cmd('OPEN', { note: 'hi' }), updatedAt: ts() }, { merge: true }));
  await deny ('a command id longer than 40 characters is refused',
    setDoc(bins(asOwner(env), 'BIN-003'), { command: cmd('OPEN', { id: 'x'.repeat(41) }), updatedAt: ts() }, { merge: true }));
  await deny ('a command the firmware does not know is refused',
    setDoc(bins(asOwner(env), 'BIN-003'), { command: cmd('SELFDESTRUCT'), updatedAt: ts() }, { merge: true }));
  await deny ('a backdated command.at is refused',
    setDoc(bins(asOwner(env), 'BIN-003'), { command: cmd('OPEN', { at: backdated() }), updatedAt: ts() }, { merge: true }));

  console.log('\nThe dashboard is not the hardware');
  await deny ('staff may not write a device reading',
    setDoc(bins(asOwner(env), 'BIN-003'), { device: { fill: 0, reportedAt: ts() }, updatedAt: ts() }, { merge: true }));
  await deny ('staff may not acknowledge a command on the board\'s behalf',
    setDoc(bins(asOwner(env), 'BIN-003'), { commandAck: { id: 'cmd-1234', result: 'ok', at: ts() }, updatedAt: ts() }, { merge: true }));

  console.log('\nThe bin id has to look like a bin id');
  await deny ('a document id that is not BIN-nnn is refused',
    setDoc(bins(asOwner(env), 'NOT-A-BIN'), { muted: true, updatedAt: ts() }, { merge: true }));
  await deny ('a short bin number is refused',
    setDoc(bins(asOwner(env), 'BIN-12'), { muted: true, updatedAt: ts() }, { merge: true }));
  await deny ('a lowercase bin id is refused',
    setDoc(bins(asOwner(env), 'bin-001'), { muted: true, updatedAt: ts() }, { merge: true }));

  console.log('\nAdministrators come from the registry, by address digest');
  await allow('an admin in the registry may command a bin',
    setDoc(bins(asAdmin(env), 'BIN-004'), { muted: true, updatedAt: ts() }, { merge: true }));
  await deny ('the same admin with an unverified address may not',
    setDoc(bins(asAdminUnv(env), 'BIN-004'), { muted: false, updatedAt: ts() }, { merge: true }));
  await deny ('someone the registry calls a viewer may not',
    setDoc(bins(asViewer(env), 'BIN-004'), { muted: false, updatedAt: ts() }, { merge: true }));
  await deny ('a verified stranger with no registry entry may not',
    setDoc(bins(asStranger(env), 'BIN-004'), { muted: false, updatedAt: ts() }, { merge: true }));

  console.log('\nAn empty allow-list allows nobody (crew and device, as shipped)');
  await deny ('the crew account is refused until its UID is in collectorUids()',
    setDoc(bins(asCrew(env), 'BIN-005'), { collectedAt: ts(), collectedByRole: 'crew', updatedAt: ts() }, { merge: true }));
  await deny ('a device is refused until its UID is in deviceBins()',
    setDoc(bins(asDevice(env), DEVICE_BIN), { device: { fill: 40, reportedAt: ts() } }, { merge: true }));

  console.log('\nThe activity log');
  await allow('an owner may append an entry',  setDoc(doc(events(asOwner(env))), validEvent(OWNER_UID, { by: 'Nischay' })));
  await allow('an admin may append an entry',  setDoc(doc(events(asAdmin(env))), validEvent('admin-uid', { by: 'Manish' })));
  await allow('staff may run the ordered, limited feed query',
    getDocs(query(events(asOwner(env)), orderBy('t', 'desc'), limit(40))));
  await deny ('an entry cannot be signed with someone else\'s uid',
    setDoc(doc(events(asOwner(env))), validEvent('somebody-else')));
  await deny ('an entry cannot carry a client-chosen time',
    setDoc(doc(events(asOwner(env))), validEvent(OWNER_UID, { t: backdated() })));
  await deny ('an invented level is refused',
    setDoc(doc(events(asOwner(env))), validEvent(OWNER_UID, { level: 'catastrophe' })));
  await deny ('a message over 140 characters is refused',
    setDoc(doc(events(asOwner(env))), validEvent(OWNER_UID, { msg: 'x'.repeat(141) })));
  await deny ('an extra field is refused',
    setDoc(doc(events(asOwner(env))), validEvent(OWNER_UID, { extra: 1 })));
  await deny ('a missing field is refused',
    setDoc(doc(events(asOwner(env))), { t: ts(), binId: 'BIN-001', msg: 'hi', level: 'info', uid: OWNER_UID }));
  await deny ('a verified stranger may not read the log', getDocs(events(asStranger(env))));

  /* An append-only log that can be rewritten is not a log. */
  let eventId = null;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const ref = doc(collection(ctx.firestore(), 'events'));
    eventId = ref.id;
    await setDoc(ref, { t: Timestamp.now(), binId: 'BIN-001', msg: 'seeded', level: 'info', by: 'x', uid: OWNER_UID });
  });
  await deny ('nobody may edit an entry after the fact',
    updateDoc(doc(asOwner(env).firestore(), 'events', eventId), { msg: 'rewritten' }));
  await allow('the owner may delete one',
    deleteDoc(doc(asOwner(env).firestore(), 'events', eventId)));

  console.log('\nThe admin registry behaves exactly as it did before');
  const NEWHASH = sha256('newcomer@example.com');
  await allow('the owner may add someone',
    setDoc(doc(asOwner(env).firestore(), 'admins', NEWHASH),
           { emailHash: NEWHASH, name: 'Newcomer', role: 'admin', addedAt: 1, addedBy: OWNER_UID }));
  await deny ('an invented role is refused',
    setDoc(doc(asOwner(env).firestore(), 'admins', NEWHASH),
           { emailHash: NEWHASH, name: 'Newcomer', role: 'superuser', addedAt: 1, addedBy: OWNER_UID }));
  await deny ('an administrator may not grant access to anyone',
    setDoc(doc(asAdmin(env).firestore(), 'admins', NEWHASH),
           { emailHash: NEWHASH, name: 'Newcomer', role: 'admin', addedAt: 1, addedBy: 'admin-uid' }));
  await deny ('a verified stranger may not either',
    setDoc(doc(asStranger(env).firestore(), 'admins', NEWHASH),
           { emailHash: NEWHASH, name: 'Newcomer', role: 'admin', addedAt: 1, addedBy: 'stranger-uid' }));
  await allow('any verified account may read the registry',
    getDoc(doc(asStranger(env).firestore(), 'admins', NEWHASH)));
  await deny ('an unverified account may not read it',
    getDoc(doc(asAdminUnv(env).firestore(), 'admins', NEWHASH)));
  await allow('the owner may remove someone',
    deleteDoc(doc(asOwner(env).firestore(), 'admins', NEWHASH)));

  console.log('\nNothing else in the database is reachable');
  await deny ('an unknown collection is closed to the owner',
    setDoc(doc(asOwner(env).firestore(), 'secrets', 'x'), { a: 1 }));
  await deny ('and closed to the public',
    getDoc(doc(asPublic(env).firestore(), 'secrets', 'x')));

  await env.cleanup();

  /* ====================================================================
     PART 2 - the same rules with the crew and device UIDs filled in
     ==================================================================== */
  env = await makeEnv(WIRED_RULES);
  await env.clearFirestore();
  await seedRegistry(env);
  await seedBin(env, DEVICE_BIN);

  console.log('\nThe collection crew, once their UID is registered');
  await allow('crew may mark a bin collected',
    setDoc(bins(asCrew(env), 'BIN-001'), { collectedAt: ts(), collectedByRole: 'crew', updatedAt: ts() }, { merge: true }));
  await allow('crew may force a full bin\'s lid open',
    setDoc(bins(asCrew(env), 'BIN-001'), { manual: true, lidOverride: 'OPEN', updatedAt: ts() }, { merge: true }));
  await allow('crew may queue EMPTY on a device-linked bin',
    setDoc(bins(asCrew(env), 'BIN-001'), { command: cmd('EMPTY', { byRole: 'crew' }), updatedAt: ts() }, { merge: true }));
  await deny ('crew may not mute a buzzer',
    setDoc(bins(asCrew(env), 'BIN-001'), { muted: true, updatedAt: ts() }, { merge: true }));
  await deny ('crew may not revive a bin with PING',
    setDoc(bins(asCrew(env), 'BIN-001'), { online: true, updatedAt: ts() }, { merge: true }));
  await deny ('crew may not queue PING either',
    setDoc(bins(asCrew(env), 'BIN-001'), { command: cmd('PING', { byRole: 'crew' }), updatedAt: ts() }, { merge: true }));
  await deny ('crew may not claim the collection was an administrator\'s',
    setDoc(bins(asCrew(env), 'BIN-001'), { collectedAt: ts(), collectedByRole: 'admin', updatedAt: ts() }, { merge: true }));
  await deny ('crew may not backdate a collection',
    setDoc(bins(asCrew(env), 'BIN-001'), { collectedAt: backdated(), collectedByRole: 'crew', updatedAt: ts() }, { merge: true }));
  await deny ('crew may not skip updatedAt',
    setDoc(bins(asCrew(env), 'BIN-001'), { collectedAt: ts(), collectedByRole: 'crew' }, { merge: true }));
  await deny ('crew may not write a device reading',
    setDoc(bins(asCrew(env), DEVICE_BIN), { device: { fill: 0, reportedAt: ts() } }, { merge: true }));
  await deny ('crew may not delete a bin',
    deleteDoc(bins(asCrew(env), 'BIN-001')));
  await allow('crew may append to the activity log',
    setDoc(doc(events(asCrew(env))), validEvent(CREW_UID)));
  await allow('crew may read the activity log',
    getDocs(query(events(asCrew(env)), orderBy('t', 'desc'), limit(40))));

  console.log('\nA registered board, reporting its own bin');
  const reading = () => ({
    fill: 72, fillA: 71, fillB: 73, lid: 'CLOSED', status: 'FULL', locked: true,
    opens: 12, refused: 3, errors: 0, sensors: 2, rssi: -61, firmware: '5.0.0',
    reportedAt: serverTimestamp(),
  });
  await allow('a board may write its own readings',
    setDoc(bins(asDevice(env), DEVICE_BIN), { device: reading() }, { merge: true }));
  /* The board usually reports before any human has touched the bin, so the
     very first write CREATES the document rather than updating one. That is a
     different rule path (there is no `resource` to diff against), and it is
     the path a freshly flashed ESP32 actually takes. */
  await env.withSecurityRulesDisabled(async (ctx) => { await deleteDoc(doc(ctx.firestore(), 'bins', DEVICE_BIN)); });
  await allow('a board may create the document with its first report',
    setDoc(bins(asDevice(env), DEVICE_BIN), { device: reading() }, { merge: true }));
  await allow('a board may acknowledge a command',
    setDoc(bins(asDevice(env), DEVICE_BIN),
           { commandAck: { id: 'cmd-1234', result: 'lid forced open (crew override - bin FULL)', at: ts() } },
           { merge: true }));
  await allow('a dead sensor reporting -1 is accepted, not refused',
    setDoc(bins(asDevice(env), DEVICE_BIN),
           { device: Object.assign(reading(), { fill: -1, fillA: -1, fillB: -1, status: 'SENSOR_ERROR' }) },
           { merge: true }));
  await deny ('a board may not report for a bin that is not its own',
    setDoc(bins(asDevice(env), 'BIN-001'), { device: reading() }, { merge: true }));
  await deny ('a board may not mute itself',
    setDoc(bins(asDevice(env), DEVICE_BIN), { device: reading(), muted: true, updatedAt: ts() }, { merge: true }));
  await deny ('a board may not mark its own bin collected',
    setDoc(bins(asDevice(env), DEVICE_BIN), { collectedAt: ts(), collectedByRole: 'crew', updatedAt: ts() }, { merge: true }));
  await deny ('a board may not backdate its report',
    setDoc(bins(asDevice(env), DEVICE_BIN),
           { device: Object.assign(reading(), { reportedAt: backdated() }) }, { merge: true }));
  await deny ('a report with no reportedAt is refused',
    setDoc(bins(asDevice(env), DEVICE_BIN), { device: { fill: 50 } }, { merge: true }));
  await deny ('a stray field inside the device map is refused',
    setDoc(bins(asDevice(env), DEVICE_BIN),
           { device: Object.assign(reading(), { temperature: 31 }) }, { merge: true }));
  await deny ('a fill sent as a string is refused',
    setDoc(bins(asDevice(env), DEVICE_BIN),
           { device: Object.assign(reading(), { fill: '72' }) }, { merge: true }));
  await deny ('a backdated commandAck is refused',
    setDoc(bins(asDevice(env), DEVICE_BIN),
           { commandAck: { id: 'cmd-1234', result: 'ok', at: backdated() } }, { merge: true }));
  await deny ('a board may not write the activity log',
    setDoc(doc(events(asDevice(env))), validEvent(DEVICE_UID)));
  await deny ('a board may not read the activity log',
    getDocs(events(asDevice(env))));
  await deny ('a board may not delete its bin',
    deleteDoc(bins(asDevice(env), DEVICE_BIN)));

  /* ====================================================================
     PART 3 - the payloads fleet-cloud.js ACTUALLY sends

     Everything above tests the rules against documents written by hand in
     this file, which proves the rules are right and proves nothing about the
     client. The interesting failure is the one where both halves are
     individually correct and disagree: the rules accept `collectedByRole`
     and the browser sends `collectedBy`, and every collection is silently
     refused on a phone nobody is watching.

     So: load the real fleet-cloud.js, point its Firestore handle at the
     emulator, and press the buttons the dashboard presses.
     ==================================================================== */
  console.log('\nWhat fleet-cloud.js actually sends, through the real rules');

  const FC_SRC = readFileSync(join(HERE, '../../website/assets/js/fleet-cloud.js'), 'utf8');

  /* A Firestore stub that forwards to a real emulator context, so FleetCloud
     builds the payload and the rules judge it. */
  function fleetCloudAs(ctx) {
    const cdb = ctx.firestore();
    let binsCb = null;
    const fakeFirebase = {
      apps: [{}],                                  /* pretend an app exists */
      initializeApp() {},
      auth: () => ({ currentUser: { uid: ctx.__uid }, onAuthStateChanged(cb) { cb({ uid: ctx.__uid }); return () => {}; } }),
      firestore: Object.assign(() => ({
        collection(name) {
          const api = {
            /* Only the bins listener is captured - FleetCloud also subscribes
               to `events`, and grabbing that callback instead would hand the
               wrong shape to seeDeviceBin below. */
            onSnapshot(next) { if (name === 'bins') binsCb = next; return () => {}; },
            orderBy() { return api; },
            limit() { return api; },
            add: (data) => setDoc(doc(collection(cdb, name)), data),
            doc: (id) => ({ set: (data, opts) => setDoc(doc(cdb, name, id), data, opts) }),
          };
          return api;
        },
      }), { FieldValue: { serverTimestamp } }),
    };
    const make = new Function('firebase', 'FIREBASE_CONFIG', 'SD', 'module',
                              FC_SRC + '\nreturn FleetCloud;');
    const FC = make(fakeFirebase,
                    { FIREBASE: { apiKey: 'AIzaFake', projectId: 'demo-sdbs' } },
                    { applyCloudOverlay() {}, applyCloudEvents() {} },
                    undefined);
    FC.start();
    /* Tell it which bins have a board behind them, the way a snapshot would. */
    return { FC, seeDeviceBin: (id) => binsCb({
      size: 1,
      docChanges: () => [{ type: 'added', doc: { id, data: () => ({ device: { fill: 40, reportedAt: Timestamp.now() } }) } }],
    }) };
  }

  const ownerCtx = asOwner(env); ownerCtx.__uid = OWNER_UID;
  const crewCtx  = asCrew(env);  crewCtx.__uid  = CREW_UID;
  const owner = fleetCloudAs(ownerCtx);
  const crew  = fleetCloudAs(crewCtx);

  /* FleetCloud swallows refusals by contract, so unwrap its result rather
     than using assertSucceeds/assertFails here. */
  async function sent(name, promise, wanted) {
    const r = await promise;
    if (!!r.ok === wanted) ok(name);
    else if (wanted) bad(name, 'the rules refused it: ' + owner.FC.explain(r.error));
    else bad(name, 'the rules ALLOWED it (they must not)');
  }

  for (const c of ['OPEN', 'CLOSE', 'AUTO', 'MUTE', 'UNMUTE', 'PING', 'EMPTY']) {
    await sent('an owner\'s ' + c + ' is accepted as sent',
               owner.FC.writeCommand('BIN-101', c, { role: 'owner', label: 'Nischay' }), true);
  }
  await sent('a crew EMPTY is accepted as sent',
             crew.FC.writeCommand('BIN-102', 'EMPTY', { role: 'collector', label: 'Crew - Ravi' }), true);
  await sent('a crew OPEN is accepted as sent',
             crew.FC.writeCommand('BIN-102', 'OPEN', { role: 'collector', label: 'Crew - Ravi' }), true);
  await sent('a crew MUTE is refused, as sent',
             crew.FC.writeCommand('BIN-102', 'MUTE', { role: 'collector', label: 'Crew - Ravi' }), false);
  await sent('a crew PING is refused, as sent',
             crew.FC.writeCommand('BIN-102', 'PING', { role: 'collector', label: 'Crew - Ravi' }), false);

  /* The device-linked path adds a `command` map, which is the part of the
     payload the rules are fussiest about. */
  owner.seeDeviceBin('BIN-103');
  crew.seeDeviceBin('BIN-103');
  await sent('an owner\'s queued command on a device-linked bin is accepted',
             owner.FC.writeCommand('BIN-103', 'OPEN', { role: 'owner', label: 'Nischay' }), true);
  await sent('a crew EMPTY queued on a device-linked bin is accepted',
             crew.FC.writeCommand('BIN-103', 'EMPTY', { role: 'collector', label: 'Crew - Ravi' }), true);
  await sent('a crew PING on a device-linked bin is still refused',
             crew.FC.writeCommand('BIN-103', 'PING', { role: 'collector', label: 'Crew - Ravi' }), false);

  await sent('an owner\'s activity-log entry is accepted as sent',
             owner.FC.logEvent('BIN-101', 'Lid opened - crew override on a FULL bin', 'success', 'Nischay'), true);
  await sent('a crew activity-log entry is accepted as sent',
             crew.FC.logEvent('BIN-102', 'Marked as collected', 'success', 'Crew - Ravi'), true);

  await env.cleanup();

  console.log('\n----------------------------------------');
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  console.log('----------------------------------------\n');
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });

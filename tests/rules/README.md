# Security Rules tests

These test `firestore.rules` at the repository root — the only access control
in this project that an attacker cannot edit. Everything else (`users.js`,
`auth.js`, the buttons the dashboard hides) decides what the interface
*offers*; these rules decide what the database *does*.

## Run them

```sh
cd tests/rules
npm install          # once - pulls the emulator, ~2 minutes
npm test
```

Expected tail:

```
  99 passed, 0 failed
```

Requirements: Node 18+ and a Java runtime (the Firestore emulator is a JAR;
Firebase asks for Java 11 or newer). Nothing is sent to Google and no login is
needed — the project id is `demo-sdbs`, and a `demo-` prefix tells the emulator
to stay entirely local.

`npm test` is `firebase emulators:exec --only firestore --project demo-sdbs
"node rules.test.mjs"`, which starts the emulator on `127.0.0.1:8085`, runs the
suite, and shuts the emulator down again.

## What is covered

99 assertions, in three passes over the same file:

**As committed** — the rules exactly as they are published.

- The bin map is world-readable and world-unwritable, and being signed in
  (including anonymously) earns nothing.
- An owner may set every staff field; may not backdate a timestamp, invent a
  lid state, send a boolean as a string, add an unknown field, or write a
  malformed command.
- Staff may not write `device` or `commandAck` — those belong to the board.
- An administrator is recognised by the SHA-256 of their verified address
  having a registry document that says `owner`/`admin`. Unverified address,
  `viewer` role, and no document at all are each refused.
- The bin id must match `BIN-nnn`.
- The activity log is append-only, cannot be signed with someone else's uid or
  a client-chosen time, and is not readable by strangers. The dashboard's
  ordered, limited feed query is allowed for staff.
- The `admins` registry behaves exactly as it did before this change.
- `collectorUids()` and `deviceBins()` ship empty, and an empty allow-list
  allows nobody.

**Wired up** — the same file with test UIDs substituted into those two
allow-lists by plain string replacement, so the crew and device rules can be
exercised before the real accounts exist.

- Crew may mark a bin collected and force a full lid open; may not mute, PING,
  claim an administrator's role, backdate a collection, skip `updatedAt`, write
  a device reading, or delete a bin.
- A board may write its own readings (including `-1` from a dead sensor) and
  acknowledge its own commands, creating the document on its first report; may
  not touch another bin, mute itself, mark itself collected, backdate a report,
  omit `reportedAt`, smuggle an extra field into the `device` map, or read the
  activity log.

**What the client actually sends** — `fleet-cloud.js` is loaded for real, its
Firestore handle is pointed at the emulator, and every command the dashboard
can issue is sent through the live rules.

This is the pass that catches the failure the other two cannot: both halves
individually correct and disagreeing with each other. If the rules accepted
`collectedByRole` while the browser sent `collectedBy`, everything above would
still be green and every collection would still be refused on a phone nobody
is watching. So each of OPEN/CLOSE/AUTO/MUTE/UNMUTE/PING/EMPTY is sent as an
owner and accepted; a crew EMPTY and OPEN are accepted; a crew MUTE and PING
are refused; and the `command` map that only device-linked bins get — the part
of the payload the rules are fussiest about — is sent and accepted for both
roles.

The suite reads the owner UIDs out of `firestore.rules` itself rather than
hard-coding them, so it cannot drift from the file it is testing.

### These tests have teeth

Verified by mutation: making `okRole()` return `true` and letting a device
write `muted` turned exactly three assertions red and left the rest green.
A rules suite that only ever says "denied" would pass while the rules refused
everybody, so the allow cases matter as much as the deny cases — both
directions are exercised here.

## A note on `firebase.json`

The `firestore` block here is empty rather than pointing at
`../../firestore.rules`. `firebase-tools` refuses a rules path outside its own
project directory, and it does not need one: `initializeTestEnvironment()`
loads the ruleset over the wire, and `rules.test.mjs` reads the real file from
the repository root itself. So the file under test is the file that ships —
there is no copy here to fall out of date.

The emulator writes a `firestore-debug.log` into this directory while it runs.

## "evaluation error" in the emulator output

Refused writes print a line like:

```
evaluation error at L160:32 for 'create' @ L160, ... false for 'create' @ L393
```

This is noise, not a defect. `changed()` diffs `request.resource.data` against
`resource.data`, and on a create there is no `resource` — the standard Firebase
idiom guards that with `resource == null ? ... : ...`. The emulator evaluates
the condition before the document state is settled and logs the error from that
first pass; the **last** verdict on the line is the real one, and it is correct.

Verified by probe: a rule that never mentions `resource` logs nothing, while
both the ternary form and a `diff(resource == null ? {} : resource.data)` form
log it — and all three reach the right verdict. There is no way to keep the
create/update diff and silence the line, so the line stays.

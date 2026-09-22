/**************************************************************************
 *  secrets.example.h  -  TEMPLATE, safe to commit (it holds no real values)
 *  ------------------------------------------------------------------------
 *  Copy this file to  secrets.h  in the SAME folder as the sketch and fill
 *  it in. The moment secrets.h exists, the ESP32 firmware turns cloud sync
 *  on; delete it and cloud sync compiles out again. secrets.h is listed in
 *  .gitignore, so it never reaches GitHub - keep it that way.
 *
 *  ONE-TIME SETUP (Firebase console, project sdbs-399da)
 *    1. Authentication > Sign-in method: Email/Password must be enabled.
 *    2. Authentication > Users > Add user. Give the BOARD its own account -
 *       never a person's. The address does not need a real mailbox, e.g.
 *           bin-001@sdbs-399da.firebaseapp.com
 *       and use a long random password that you use nowhere else.
 *    3. Copy that user's UID (also printed on the serial monitor the first
 *       time the board signs in) and map it to this board's bin:
 *           firestore.rules      deviceBins()  { "<UID>": "BIN-001" }
 *           firebase-config.js   DEVICE_BINS   { "<UID>": "BIN-001" }
 *       then publish the rules. Until you do, every write is refused and
 *       the board prints  "Cloud: 403 - rules not published, or this
 *       device's UID is not in deviceBins()".
 *    4. DEVICE_ID in the sketch must be the same bin id as in step 3.
 *
 *  WHAT THIS ACCOUNT CAN DO
 *    The Firestore rules let a device account write only the "device" and
 *    "commandAck" fields of its own bins/<DEVICE_ID> document. If this
 *    password ever leaks, the worst case is fake telemetry for that one
 *    bin - reset the password in the console and update this file.
 *
 *  WOKWI: add this as a new file tab called secrets.h. A PUBLIC Wokwi
 *  project shows every tab to anyone who opens it - keep the project
 *  private (see simulation/wokwi/README.md).
 **************************************************************************/
#ifndef SECRETS_H
#define SECRETS_H

#define DEVICE_EMAIL    "bin-001@sdbs-399da.firebaseapp.com"
#define DEVICE_PASSWORD "paste-the-board-password-here"

#endif /* SECRETS_H */

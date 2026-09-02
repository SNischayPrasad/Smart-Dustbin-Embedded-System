#!/usr/bin/env node
/* Generate the emailHash value for website/assets/js/users.js
   Usage:  node tools/hash-email.js someone@example.com                     */

const crypto = require("crypto");
const email = (process.argv[2] || "").trim().toLowerCase();

if (!email || email.indexOf("@") === -1) {
  console.error("Usage: node tools/hash-email.js someone@example.com");
  process.exit(1);
}

const hash = crypto.createHash("sha256").update(email).digest("hex");

console.log("");
console.log("  address : " + email);
console.log("  sha256  : " + hash);
console.log("");
console.log("  Paste into website/assets/js/users.js:");
console.log("");
console.log('    { emailHash: "' + hash + '",');
console.log('      name: "Your Name", role: "admin" }');
console.log("");
console.log("  Note: hashing keeps the address out of a public repo. It is not");
console.log("  encryption - anyone who guesses the address can confirm it.");
console.log("");

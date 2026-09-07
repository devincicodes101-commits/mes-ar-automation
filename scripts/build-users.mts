/**
 * Generates the password hashes in src/lib/auth.ts.
 *
 *   npm run users
 *
 * Run this after changing a demo password. It rewrites the hash fields in
 * place, so no hash is ever typed by hand and the file can never drift from
 * the passwords it is meant to accept.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../src/lib/auth.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, "..", "src", "lib", "auth.ts");

/**
 * The demo passwords. Obvious on purpose: this is a prototype and these are
 * meant to be replaced before anybody outside the project sees it.
 */
const PASSWORDS: Record<string, string> = {
  "superadmin@mesgroup.com": "superadmin@2026",
  "admin@mesgroup.com": "admin@2026",
  "csd@mesgroup.com": "csd@2026",
  "rm@mesgroup.com": "rm@2026",
  "management@mesgroup.com": "management@2026",
};

let src = readFileSync(FILE, "utf8");
const rows: string[] = [];

for (const [username, password] of Object.entries(PASSWORDS)) {
  // Usernames are email addresses, so the dots would otherwise be wildcards.
  const safe = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = new RegExp(
    `(username: "${safe}",[\\s\\S]*?salt: "([0-9a-f]+)",\\s*hash: ")([^"]*)(")`,
  );
  const m = block.exec(src);
  if (!m) {
    console.error(`No seed user for "${username}" in auth.ts`);
    process.exit(1);
  }
  const hash = await hashPassword(password, m[2]);
  src = src.replace(block, `$1${hash}$4`);
  rows.push(`  ${username.padEnd(12)} ${password.padEnd(18)} ${hash.slice(0, 24)}…`);
}

writeFileSync(FILE, src, "utf8");
console.log(`updated ${path.relative(path.join(HERE, ".."), FILE)}\n`);
console.log("  username     password           hash");
console.log("  " + "-".repeat(60));
for (const r of rows) console.log(r);
console.log("\n  These are demo credentials. Replace them before go-live.");

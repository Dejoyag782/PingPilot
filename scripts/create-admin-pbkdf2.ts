import { randomBytes, webcrypto } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const rl = createInterface({ input, output });
const username = (await rl.question("Admin username: ")).trim();
const password = await rl.question("Admin password (12+ chars): ");
const database = (await rl.question("Database target (local/remote): ")).trim().toLowerCase();
rl.close();
if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new Error("Username must be 3-40 characters.");
if (password.length < 12 || password.length > 200) throw new Error("Password must be 12-200 characters.");
if (database !== "local" && database !== "remote") throw new Error("Choose local or remote explicitly.");
const salt = randomBytes(24).toString("hex");
const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
const bits = await webcrypto.subtle.deriveBits({name:"PBKDF2",salt:new TextEncoder().encode(salt),iterations:100000,hash:"SHA-256"},key,256);
const hash = Buffer.from(bits).toString("hex");
const id = randomBytes(16).toString("hex");
const esc = (s:string) => s.replace(/'/g,"''");
// Upsert: re-running for an existing username resets its password and signs out its sessions.
const sql = `INSERT INTO admins (id, username, password_hash, password_salt) VALUES ('${id}','${esc(username)}','${hash}','${salt}')
ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, password_salt=excluded.password_salt;
DELETE FROM sessions WHERE admin_id=(SELECT id FROM admins WHERE username='${esc(username)}');`;
// Run wrangler's JS entry with node directly: on Windows "npx" is a .cmd shim that
// execFileSync can't spawn without a shell, and a shell would mangle the SQL quoting.
const wrangler = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
const args = [wrangler,"d1","execute","pingpilot-db",`--${database}`,"--command",sql];
console.log(`Creating admin in ${database} D1. Keep the password private.`);
execFileSync(process.execPath,args,{stdio:"inherit"});
console.log("Admin created (or password updated if the username already existed).");

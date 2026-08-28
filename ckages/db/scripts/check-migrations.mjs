import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const journal = JSON.parse(await readFile(resolve(root, "migrations/meta/_journal.json"), "utf8"));
const files = (await readdir(resolve(root, "migrations"))).filter((file) => file.endsWith(".sql")).sort();
const expected = journal.entries.map(({ tag }) => `${tag}.sql`);

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  throw new Error(`Migration journal mismatch: files=${files.join(",")} journal=${expected.join(",")}`);
}

console.log(`Migration journal verified (${files.length} migrations).`);

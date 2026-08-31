import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const journal = JSON.parse(await readFile(resolve(root, "migrations/meta/_journal.json"), "utf8"));
const files = (await readdir(resolve(root, "migrations"))).filter((file) => file.endsWith(".sql")).sort();
const expected = journal.entries.map(({ tag }) => `${tag}.sql`);

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  throw new Error(`Migration journal mismatch: files=${files.join(",")} journal=${expected.join(",")}`);
}

// A row-level security policy that compares a bare column name against a column of the same name in
// its own subquery is a tautology, not an ownership check: PostgreSQL resolves the unqualified side
// to the inner range table. Qualify the outer table (`files.owner_id`, `embedding_chunks.owner_id`).
const tautology = /\b([a-z_]+)\.(owner_id|user_id)=\2\b/;
// 0006 shipped with this defect and is corrected forward by 0009; it must not be edited in place.
const supersededDefects = new Map([["0006_retrieval.sql", "0009_fix_embedding_owner_policy.sql"]]);

for (const file of files) {
  const source = await readFile(resolve(root, "migrations", file), "utf8");
  // Comments legitimately quote the defective pattern when explaining a corrective migration.
  const sql = source.replace(/--[^\n]*/g, "");
  const match = tautology.exec(sql);
  if (!match) continue;
  const corrective = supersededDefects.get(file);
  if (!corrective) {
    throw new Error(`${file} compares ${match[0]} inside a subquery, which is always true. Qualify the outer table.`);
  }
  if (!files.includes(corrective)) {
    throw new Error(`${file} contains a known policy defect but its corrective migration ${corrective} is missing.`);
  }
}

console.log(`Migration journal verified (${files.length} migrations, ${supersededDefects.size} superseded defect corrected).`);

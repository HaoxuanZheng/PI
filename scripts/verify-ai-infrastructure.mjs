import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
const root=resolve(import.meta.dirname,"..");
const required=["packages/ai/src/index.ts","packages/ai/tests/ai-foundation.test.ts","packages/db/migrations/0004_ai_infrastructure.sql","packages/db/src/repositories/ai-operations.ts","apps/web/app/api/v1/ai/operations/route.ts","docs/architecture/0011-ai-proposals-not-writes.md","docs/runbooks/ai-infrastructure.md"];
await Promise.all(required.map(path=>access(resolve(root,path))));
const ai=await readFile(resolve(root,required[0]),"utf8");for(const invariant of ["interface AIProvider","generateValidatedStructured","aiPatchProposalSchema","applySafePatch","validateProposalContext"])if(!ai.includes(invariant))throw new Error(`AI package missing: ${invariant}`);
const migration=await readFile(resolve(root,required[2]),"utf8");for(const invariant of ["ai_operations_target_revision_fk","ai_operations_proposal_identity","ai_operations_valid_pending","ai_operations_core_immutable","ENABLE ROW LEVEL SECURITY","p.capability IN ('EDIT','COLLABORATE','ADMIN')"])if(!migration.includes(invariant))throw new Error(`AI migration missing: ${invariant}`);
const routes=await readFile(resolve(root,required[4]),"utf8");if(/export async function POST/.test(routes))throw new Error("V0.6 must not expose a client-supplied AI operation write endpoint");
console.log(`AI Infrastructure verified (${required.length} required files).`);

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { aiPatchProposalSchema, applySafePatch, generateValidatedStructured, validateProposalContext, type AIProvider } from "../src/index";
const objectId=randomUUID(),revisionId=randomUUID(),operationId=randomUUID();
const proposal={operationId,target:{objectId,baseRevisionId:revisionId},summary:"Improve title",operations:[{op:"replace",path:"/title",before:"Old",after:"New"}],evidence:[],warnings:[],confidence:.9};
describe("AI foundation",()=>{
 it("validates and deterministically applies a safe proposal",()=>{const parsed=aiPatchProposalSchema.parse(proposal);expect(applySafePatch({schemaVersion:1,type:"NOTE",title:"Old",tags:[],customFields:{}},parsed).title).toBe("New");});
 it("rejects arbitrary paths and stale preconditions",()=>{expect(aiPatchProposalSchema.safeParse({...proposal,operations:[{op:"replace",path:"/__proto__",before:null,after:{}}]}).success).toBe(false);expect(()=>applySafePatch({schemaVersion:1,type:"NOTE",title:"Different",tags:[],customFields:{}},aiPatchProposalSchema.parse(proposal))).toThrow(/precondition/);});
 it("requires evidence to come from permitted retrieved context",()=>{const evidenceProposal=aiPatchProposalSchema.parse({...proposal,evidence:[{sourceObjectId:objectId,sourceRevisionId:revisionId,reason:"Evidence"}]});expect(()=>validateProposalContext(evidenceProposal,[],{requestedScopes:[],retrieved:[]})).toThrow(/manifest/);});
 it("rejects invalid output even when a provider lies about its generic type",async()=>{const provider:AIProvider={name:"test",model:"invalid",async generateStructured<T>(){return {unsafe:true} as T;},async generateText(){return{text:"",provider:"test",model:"invalid"};},async embed(inputs){return inputs.map(()=>[]);}};await expect(generateValidatedStructured(provider,{schema:aiPatchProposalSchema,system:"test",input:"test",promptVersion:"test@1"})).rejects.toThrow();});
});

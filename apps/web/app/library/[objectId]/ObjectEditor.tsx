"use client";

import { snapshotBlocks, type EditorBlock, type ObjectSnapshot } from "@lifegraph/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import { InlineAI } from "./InlineAI";

type SaveState = "clean" | "dirty" | "saving" | "saved" | "offline" | "conflict" | "error";
type Props = { objectId: string; initialRevisionId: string; initialSnapshot: ObjectSnapshot; canEdit: boolean };

function newBlock(type: EditorBlock["type"] = "paragraph"): EditorBlock {
  return { id: crypto.randomUUID(), type, text: "" };
}

export function ObjectEditor({ objectId, initialRevisionId, initialSnapshot, canEdit }: Props) {
  const draftKey = `lifegraph:draft:${objectId}`;
  const [snapshot, setSnapshot] = useState<ObjectSnapshot>(() => ({ ...initialSnapshot, body: { format: "richtext", content: snapshotBlocks(initialSnapshot) } }));
  const [revisionId, setRevisionId] = useState(initialRevisionId);
  const [status, setStatus] = useState<SaveState>("clean");
  const [restoredDraft, setRestoredDraft] = useState(false);
  const latest = useRef(snapshot);
  const revision = useRef(revisionId);
  const saving = useRef(false);
  const queued = useRef<ObjectSnapshot | null>(null);
  const skipFirstSave = useRef(true);
  const blockedByConflict = useRef(false);
  const [aiSelection,setAISelection]=useState<{blockId:string;text:string}|null>(null);

  useEffect(() => {
    if (!canEdit) return;
    const stored = localStorage.getItem(draftKey);
    if (stored) {
      try {
        const draft = JSON.parse(stored) as { baseRevisionId: string; snapshot: ObjectSnapshot };
        if (JSON.stringify(draft.snapshot) === JSON.stringify(initialSnapshot)) {
          localStorage.removeItem(draftKey);
          return;
        }
        setSnapshot(draft.snapshot);
        latest.current = draft.snapshot;
        if (draft.baseRevisionId !== initialRevisionId) {
          blockedByConflict.current = true;
          setStatus("conflict");
        } else setStatus("dirty");
        setRestoredDraft(true);
      } catch { localStorage.removeItem(draftKey); }
    }
  }, [canEdit, draftKey, initialRevisionId, initialSnapshot]);

  const persist = useCallback(async function persistSnapshot(next: ObjectSnapshot): Promise<void> {
    if (saving.current) { queued.current = next; return; }
    saving.current = true;
    setStatus("saving");
    try {
      const response = await fetch(`/api/v1/objects/${objectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevisionId: revision.current, snapshot: next })
      });
      const payload = await response.json();
      if (response.status === 409 && payload?.error?.code === "REVISION_CONFLICT") {
        blockedByConflict.current = true;
        setStatus("conflict");
        return;
      }
      if (!response.ok) throw new Error(payload?.error?.code ?? "SAVE_FAILED");
      const nextRevision = payload.data.currentRevision.id as string;
      revision.current = nextRevision;
      setRevisionId(nextRevision);
      if (JSON.stringify(latest.current) === JSON.stringify(next)) {
        localStorage.removeItem(draftKey);
        setStatus("saved");
      } else setStatus("dirty");
    } catch {
      setStatus(navigator.onLine ? "error" : "offline");
    } finally {
      saving.current = false;
      const pending = queued.current;
      queued.current = null;
      if (pending && !blockedByConflict.current) await persistSnapshot(pending);
    }
  }, [draftKey, objectId]);

  useEffect(() => {
    latest.current = snapshot;
    if (!canEdit) return;
    if (skipFirstSave.current) { skipFirstSave.current = false; return; }
    localStorage.setItem(draftKey, JSON.stringify({ baseRevisionId: revision.current, snapshot, savedAt: new Date().toISOString() }));
    setStatus((current) => current === "conflict" ? current : "dirty");
    if (blockedByConflict.current) return;
    const timer = window.setTimeout(() => void persist(snapshot), 900);
    return () => window.clearTimeout(timer);
  }, [snapshot, canEdit, draftKey, persist]);

  function updateSnapshot(patch: Partial<ObjectSnapshot>) {
    setSnapshot((current) => ({ ...current, ...patch }));
  }

  function updateBlock(id: string, patch: Partial<EditorBlock>) {
    const blocks = snapshotBlocks(snapshot).map((block) => block.id === id ? { ...block, ...patch } : block);
    updateSnapshot({ body: { format: "richtext", content: blocks } });
  }

  function removeBlock(id: string) {
    const blocks = snapshotBlocks(snapshot).filter((block) => block.id !== id);
    updateSnapshot({ body: { format: "richtext", content: blocks.length ? blocks : [newBlock()] } });
  }

  const statusText: Record<SaveState, string> = {
    clean: "Up to date", dirty: "Unsaved changes", saving: "Saving…", saved: "Saved",
    offline: "Offline — draft kept on this device", conflict: "Conflict — a newer revision exists", error: "Save failed — draft kept on this device"
  };

  if (!canEdit) return (
    <section className="editor readOnlyEditor" aria-label="Read-only object">
      <p className="notice">You have read access. Editing and restore require EDIT permission.</p>
      <h1>{snapshot.title ?? "Untitled"}</h1>
      {snapshotBlocks(snapshot).map((block) => block.type === "heading"
        ? <h2 key={block.id}>{block.text}</h2>
        : <p key={block.id} className={block.type === "bullet" ? "readBullet" : undefined}>{block.text}</p>)}
    </section>
  );

  return (
    <section className="editor" aria-labelledby="editor-title">
      <div className="editorTopline">
        <p className="eyebrow" id="editor-title">Block editor · revision {revisionId.slice(0, 8)}</p>
        <span className={`saveState saveState-${status}`} role="status">{statusText[status]}</span>
      </div>
      {restoredDraft && <p className="notice">Recovered an unsaved local draft. Autosave will reconcile it with the current revision.</p>}
      {status === "conflict" && <div className="notice error conflictNotice">
        <span>A newer revision won. Your local draft is intact.</span>
        <button className="button buttonSecondary" onClick={() => { localStorage.removeItem(draftKey); location.reload(); }} type="button">Discard draft & load latest</button>
      </div>}
      <input aria-label="Title" className="titleInput" maxLength={300} onChange={(event) => updateSnapshot({ title: event.target.value || null })} value={snapshot.title ?? ""} />
      <textarea aria-label="Summary" className="summaryInput" maxLength={2000} onChange={(event) => updateSnapshot({ summary: event.target.value || null })} placeholder="Optional summary" rows={2} value={snapshot.summary ?? ""} />
      <div className="blockList">
        {snapshotBlocks(snapshot).map((block) => <div className="editorBlock" key={block.id}>
          <select aria-label="Block type" onChange={(event) => updateBlock(block.id, { type: event.target.value as EditorBlock["type"] })} value={block.type}>
            <option value="paragraph">Text</option><option value="heading">Heading</option><option value="bullet">Bullet</option>
          </select>
          <textarea aria-label={`${block.type} block`} className={`blockInput block-${block.type}`} onChange={(event) => updateBlock(block.id, { text: event.target.value })} onSelect={(event)=>{const field=event.currentTarget;const text=field.value.slice(field.selectionStart,field.selectionEnd);if(text.trim())setAISelection({blockId:block.id,text});}} rows={block.type === "heading" ? 1 : 3} value={block.text} />
          <button aria-label="Remove block" className="iconButton" onClick={() => removeBlock(block.id)} type="button">×</button>
        </div>)}
      </div>
      <div className="blockActions">
        <button className="button buttonSecondary" onClick={() => updateSnapshot({ body: { format: "richtext", content: [...snapshotBlocks(snapshot), newBlock()] } })} type="button">+ Text block</button>
        <button className="button buttonSecondary" onClick={() => updateSnapshot({ body: { format: "richtext", content: [...snapshotBlocks(snapshot), newBlock("heading")] } })} type="button">+ Heading</button>
      </div>
      {aiSelection&&<InlineAI baseRevisionId={revisionId} blockId={aiSelection.blockId} objectId={objectId} onClose={()=>setAISelection(null)} selectedText={aiSelection.text}/>} 
    </section>
  );
}

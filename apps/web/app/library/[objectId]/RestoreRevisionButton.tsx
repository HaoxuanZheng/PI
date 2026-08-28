"use client";

import { useRef } from "react";
import { restoreRevision } from "../actions";

export function RestoreRevisionButton(props: { objectId: string; revisionId: string; expectedRevisionId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button className="button buttonSecondary" onClick={() => dialog.current?.showModal()} type="button">Restore</button>
    <dialog className="restoreDialog" ref={dialog}>
      <div>
        <h3>Restore this revision?</h3>
        <p>The current history stays immutable. Restore creates a new revision from this snapshot.</p>
        <div className="dialogActions">
          <form method="dialog"><button className="button buttonSecondary" type="submit">Cancel</button></form>
          <form action={restoreRevision}>
            <input name="objectId" type="hidden" value={props.objectId} />
            <input name="revisionId" type="hidden" value={props.revisionId} />
            <input name="expectedRevisionId" type="hidden" value={props.expectedRevisionId} />
            <button className="button" type="submit">Create restored revision</button>
          </form>
        </div>
      </div>
    </dialog>
  </>;
}

export type Result<T, E extends string = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export type RequestContext = {
  requestId: string;
  actorId: string | null;
};

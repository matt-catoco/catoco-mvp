import { randomUUID } from "node:crypto";

// Structural rather than PostgrestError specifically — this also covers
// AuthError (sign-in), which has the same message/code shape but isn't a
// PostgrestError.
type DbError = { message: string; code?: string | null };

// Postgres error code for a plpgsql `raise exception 'message'` — every
// RPC in this app writes that message to be read by whoever's using the
// product (e.g. "Pick a travel date", "a locked element needs exactly one
// value"). Any other code (constraint violation, ambiguous/missing
// function, permission error, connection failure...) is an internal
// failure never meant to be read directly — showing it verbatim leaks
// schema/implementation details and just looks broken. The duplicate
// create_element() overload surfacing raw "Could not choose the best
// candidate function..." text to whoever clicked Add Element is exactly
// the case this guards against.
const APPLICATION_RAISED_CODE = "P0001";

/**
 * Turns a Supabase/Postgres error into text safe to hand back to whoever's
 * using the app. Deliberate `raise exception` messages pass through as-is;
 * everything else — real DB/infrastructure failures — is logged server-side
 * (with a short reference code) and replaced with a generic message plus
 * that same code, instead of leaking raw error internals. Hiding the real
 * message shouldn't also mean losing the ability to track it down — the
 * ref is how "something went wrong" turns back into a specific log line
 * (`get_runtime_logs` / `get_runtime_errors`, search for the ref) once
 * someone reports it.
 */
export function toUserFacingError(error: DbError): string {
  if (error.code === APPLICATION_RAISED_CODE) return error.message;
  const ref = randomUUID().slice(0, 8);
  console.error(`[db error] ref=${ref}`, error);
  return `Something went wrong on our end. Please try again — if it keeps happening, mention reference ${ref}.`;
}

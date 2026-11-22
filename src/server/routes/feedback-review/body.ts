/**
 * EPIC-230 (SLICE-230-4): shared body reader — the interaction
 * payload cap applies to both surfaces (they are the same class of
 * agent write). Body may already be buffered (did-auth reads it for
 * hashing); returns a Response on cap/parse failure.
 */

import type { Context } from "hono";

import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import { readBodyCap } from "../../lib/request-inbox/intake";
import { INTERACTION_PAYLOAD_MAX } from "../../lib/agent-interaction/requests";

export async function readJsonBody(c: Context): Promise<unknown | Response> {
  const raw = c.req.raw.bodyUsed
    ? await c.req.text()
    : await readBodyCap(c, INTERACTION_PAYLOAD_MAX);
  if (raw === null || Buffer.byteLength(raw, "utf8") > INTERACTION_PAYLOAD_MAX) {
    return errorResponse(
      c,
      400,
      ErrorCodes.INVALID_INPUT,
      `body exceeds ${INTERACTION_PAYLOAD_MAX} bytes`,
    );
  }
  try {
    return JSON.parse(raw || "null");
  } catch {
    return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "invalid JSON body");
  }
}

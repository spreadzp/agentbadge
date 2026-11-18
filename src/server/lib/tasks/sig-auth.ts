/** Shared sig-auth gate for agent-contour writes (D-206-3):
 *  X-Wallet/X-Sig/X-Timestamp EIP-191 over wallet+method+path+timestamp.
 *  Returns the authenticated wallet, or a ready 401 Response. */
import type { Context } from "hono";
import { verifySignedRequest } from "../../middleware/agent-auth";
import { errorResponse } from "../error-response";
import { ErrorCodes } from "../error-codes";

export async function requireSigAuth(c: Context): Promise<string | Response> {
  const sig = await verifySignedRequest(c);
  if (sig === "replay") {
    return errorResponse(c, 409, ErrorCodes.CONFLICT, "replayed signed request");
  }
  if (sig !== "valid") {
    return errorResponse(
      c,
      401,
      ErrorCodes.WRONG_SIGNER,
      "Missing or invalid sig-auth headers (X-Wallet/X-Sig/X-Timestamp/X-Nonce)",
    );
  }
  return c.req.header("x-wallet")!;
}

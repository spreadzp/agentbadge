/**
 * GET /auth/challenge — DID-auth challenge-issuing endpoint.
 *
 * Advertised in llms.txt, agents.txt, market guides and agent-card.json
 * (challenge_endpoint) since EPIC-82, but never mounted — the URL-matrix
 * audit (SLICE-259-15) caught it as advertised-but-dead (404).
 * Mounts the existing challengeHandler against the SAME NonceStore
 * requireDidSignature consumes from.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { challengeHandler, didAuthNonceStore } from "../../middleware/did-auth";

export const authChallengeRoutes = new Hono();

authChallengeRoutes.get(
  "/auth/challenge",
  describeRoute({
    tags: ["DID"],
    summary: "Issue a DID-auth challenge (nonce + timestamp)",
    description:
      "Returns the canonical `agentbadge-action:v1` challenge string, a " +
      "single-use nonce and a unix timestamp for ?did&method&path. Sign " +
      "the challenge with the DID's account key and send it back via the " +
      "X-AgentBadge-* headers on mutation endpoints.",
    responses: {
      200: { description: "challenge + nonce + timestamp" },
      400: { description: "Missing did/method/path query params" },
    },
  }),
  (c, next) => challengeHandler({ nonceStore: didAuthNonceStore() })(c, next),
);

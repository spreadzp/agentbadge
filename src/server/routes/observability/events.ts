/**
 * Events route — GET /events
 *
 * SLICE-90-11: Query indexed on-chain events from Base Sepolia contracts.
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { errorSchema } from "../../openapi";
import { ErrorCodes } from "../../lib/error-codes";
import { errorResponse } from "../../lib/error-response";

export const eventSchema = z.object({
  blockNumber: z.number(),
  txHash: z.string(),
  eventName: z.string(),
  args: z.record(z.string(), z.unknown()),
  logIndex: z.number(),
  source: z.enum(["passport", "escrow"]),
});

export const eventsRoutes = new Hono();

eventsRoutes.get(
  "/events",
  describeRoute({
    tags: ["Events"],
    summary: "Get on-chain events",
    description:
      "Returns indexed events from Base Sepolia smart contracts (AgentPassport, TaskEscrow), optionally filtered by event name, source, or block range.",
    responses: {
      200: {
        description: "Events retrieved",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                events: z.array(eventSchema),
                total: z.number(),
              }),
            ),
          },
        },
      },
      500: {
        description: "Failed to fetch events",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      503: {
        description: "Event indexer not enabled in this deployment (CHAIN_MODE=base required)",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const eventName = c.req.query("eventName");
    const source = c.req.query("source");
    const fromBlock = c.req.query("fromBlock");
    const toBlock = c.req.query("toBlock");
    const limit = c.req.query("limit");

    try {
      const { getBaseEventIndexer, isBaseEventIndexerStarted } = await import("../../lib/base-event-indexer");

      // SLICE-234-37: indexer only runs under CHAIN_MODE=base — in hedera
      // mode it never starts, so answer an honest 503 instead of 500.
      if (!isBaseEventIndexerStarted()) {
        return errorResponse(
          c,
          503,
          ErrorCodes.EVENTS_INDEXER_DISABLED,
          "Event indexer is not enabled in this deployment (requires CHAIN_MODE=base)",
          { retryable: false },
        );
      }

      const indexer = getBaseEventIndexer() as unknown as { getIndexedEvents: () => unknown[] };

      let events: Record<string, unknown>[] = indexer.getIndexedEvents() as Record<string, unknown>[];

      if (source) {
        events = events.filter((e) => e.source === source);
      }
      if (eventName) {
        events = events.filter((e) => e.eventName === eventName);
      }
      if (fromBlock) {
        const from = Number(fromBlock);
        events = events.filter((e) => Number(e.blockNumber) >= from);
      }
      if (toBlock) {
        const to = Number(toBlock);
        events = events.filter((e) => Number(e.blockNumber) <= to);
      }

      const maxLimit = limit ? Number(limit) : 100;
      events = events.slice(0, maxLimit);

      return c.json({ events, total: events.length });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to fetch events";
      return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, message, { retryable: true });
    }
  },
);

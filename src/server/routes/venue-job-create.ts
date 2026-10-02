/**
 * SLICE-153-3: shared createJob handler — POST /api/venue/jobs and
 * POST /api/venue/instances/:id/jobs (forced venue scope).
 *
 * Business venues: onchain description is only `bv:<slug>:<commitment-tag>`
 * (≤128 chars, no details); the full payload lands in the meta-lane private
 * record (see lib/venue/private-jobs.ts). With ARC_BV_MEMO_LINK≠0 an extra
 * memo tx links jobId↔commitment onchain. Public venues unchanged.
 */
import type { Context } from "hono";
import { randomBytes } from "node:crypto";
import {
  encodeFunctionData,
  getAddress,
  isAddress,
  parseUnits,
} from "viem";
import { MEMO_ABI } from "@agentbadge/circle-payments";

import type { VenueNetwork } from "../lib/venue/chain";
import type { VenueJob } from "../lib/venue/store";
import { upsertJob } from "../lib/venue/store";
import { getVenue } from "../lib/venue/venues";
import { venueEconomics, resolveFeeMode } from "../lib/venue/economics";
import {
  buildPrivateJob,
  memoLinkEnabled,
  privateMemoContext,
  privateMemoId,
  privateTag,
  savePrivateJob,
  type PrivateJobPayload,
} from "../lib/venue/private-jobs";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { recordVenueEvent } from "../services/venue-events";
import {
  resolveVenueEvaluator,
  signedJson,
  str,
} from "./venue-api-helpers";
import { venueScopeOr404 } from "./venue-api-instances";

export async function createVenueJob(
  c: Context,
  net: () => VenueNetwork,
  forcedVenue?: string,
): Promise<Response> {
  const s = await signedJson(c);
  if (s instanceof Response) return s;
  const { body } = s;
  const title = str(body.title, 120);
  const description = str(body.description, 2000);
  const category = body.category == null ? undefined : str(body.category, 50);
  const budgetUsdc = Number(body.budgetUsdc);
  if (!title || !description) {
    return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS,
      "title (≤120) + description (≤2000) required");
  }
  if (!Number.isFinite(budgetUsdc) || budgetUsdc <= 0 || budgetUsdc > 1_000_000) {
    return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
      "budgetUsdc must be a number in (0, 1000000]");
  }
  const provider = str(body.provider, 42);
  if (provider != null && !isAddress(provider)) {
    return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "provider must be 0x…");
  }
  const jobVenueId = venueScopeOr404(
    c,
    forcedVenue ?? str(body.venue, 64) ?? str(body.venueId, 64),
    s.wallet,
  ); // 153-1/2/3
  if (jobVenueId instanceof Response) return jobVenueId;
  const venue = jobVenueId ? getVenue(jobVenueId) : undefined;
  const isBusiness = venue?.kind === "business";

  const n = net(), econ = venueEconomics();
  // 153-4: business venues pin the evaluator to policies.evaluator —
  // evaluate/reject then requires that wallet (actorAllowed on job.evaluator).
  const evaluator = resolveVenueEvaluator(isBusiness ? venue : undefined);
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400);
  const jobId = `vj_${randomBytes(8).toString("hex")}`;
  const job: VenueJob = {
    jobId, title, description, budgetUsdc,
    status: "pending",
    client: s.wallet,
    provider: provider ? getAddress(provider) : undefined,
    evaluator,
    category: category ?? undefined,
    venueId: jobVenueId,
    createdAt: new Date().toISOString(),
    chainTxs: {},
  };

  // 153-3: business venues keep details off-chain. The supplied description
  // (or privateDetails.descriptionFull) is the private payload; onchain gets
  // only bv:<slug>:<commitment-tag>. Without privateDetails the payload
  // defaults to the public description — verify-commitment still works.
  let onchainDesc = `${title} — ${description}`.slice(0, 512);
  let priv: PrivateJobPayload | undefined;
  if (isBusiness && venue) {
    const details = (body.privateDetails ?? {}) as {
      descriptionFull?: unknown;
      terms?: unknown;
    };
    try {
      priv = buildPrivateJob({
        jobId,
        venue,
        details: {
          descriptionFull: details.descriptionFull != null
            ? String(details.descriptionFull)
            : description,
          terms: details.terms != null ? String(details.terms) : undefined,
        },
      });
    } catch (err) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, String(err));
    }
    savePrivateJob(priv);
    job.private = true;
    onchainDesc = privateTag(venue, priv.commitment);
  }

  // 152-4: resolve take-rate mode at creation (open jobs re-resolve at
  // claim once provider is known) and arm the eval-fee ledger.
  job.feeMode = resolveFeeMode(job, econ, n);
  if (econ.evalFeeAtomic > 0n) {
    job.evalFee = {
      required: true,
      paid: false,
      amountAtomic: econ.evalFeeAtomic.toString(),
    };
  }
  upsertJob(job);
  recordVenueEvent({
    action: "job.created",
    text: `job posted — “${title}” · $${budgetUsdc} USDC`,
    jobId,
    dedupeKey: `job.created:${jobId}`,
  });
  const createData = encodeFunctionData({
    abi: n.abi,
    functionName: "createJob",
    args: [
      (provider ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
      evaluator, expiredAt,
      onchainDesc,
      // 152-4: IACPHook address when hook fee mode is configured.
      (econ.feeHook ??
        "0x0000000000000000000000000000000000000000") as `0x${string}`,
    ],
  } as never);
  const budgetBase = parseUnits(String(budgetUsdc), 6);

  // 153-3: optional memo link — publicly verifiable jobId↔commitment.
  const memoLink = priv && memoLinkEnabled()
    ? {
      to: n.memo,
      data: encodeFunctionData({
        abi: MEMO_ABI,
        functionName: "memo",
        args: [
          n.agenticCommerce,
          "0x",
          privateMemoId(job.jobId, jobVenueId!),
          privateMemoContext(priv.commitment),
        ],
      } as never),
      description: `memo(noop) — links ${job.jobId} ↔ commitment onchain`,
    }
    : undefined;

  return c.json({
    job,
    network: n.name,
    txs: {
      createJob: {
        to: n.agenticCommerce,
        data: createData,
        description:
          `Broadcast this tx, then POST /api/venue/jobs/${jobId}/tx ` +
          `{hash, phase:'created'} to attach it.`,
      },
      ...(memoLink ? { memoLink } : {}),
      note:
        `After createJob confirms: setBudget(jobId, ${budgetBase}, 0x), ` +
        `then approve USDC + fund(jobId, ${budgetBase}, 0x).`,
    },
  });
}

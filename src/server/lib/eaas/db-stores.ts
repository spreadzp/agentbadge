/**
 * SLICE-155-12: db-first store selection for EaaS wiring.
 * Each picker returns the Postgres mirror+write-behind store when
 * DATABASE_ENABLED supplies a repo, else the json fallback — keeps
 * wiring/eaas.ts under max-lines without per-site `??` chains.
 */
import type { getDatabase } from "../database";
import { createDbAnchorStore } from "./anchor-db";
import { createJsonAnchorStore } from "./anchor";
import { createDbRequestStore } from "./requests-db";
import { createJsonRequestStore } from "./requests";
import { createDbSubscriptionStore } from "./subscription-db";
import { createJsonSubscriptionStore } from "./subscription";
import { createDbContractStore } from "./contracts-db";
import { createJsonContractStore } from "./contracts";
import { createDbEvalStore } from "./eval-store-db";
import { createJsonEvalStore } from "./eval-store";

type Db = ReturnType<typeof getDatabase>;

export function pickAnchorStore(db: Db) {
  return (
    createDbAnchorStore(db.eaasAnchors) ??
    createJsonAnchorStore(".data/eaas-anchors.json")
  );
}

export function pickRequestStore(db: Db) {
  return createDbRequestStore(db.eaasRequests) ?? createJsonRequestStore();
}

export function pickSubscriptionStore(db: Db) {
  return (
    createDbSubscriptionStore(db.eaasSubscriptions) ??
    createJsonSubscriptionStore()
  );
}

export function pickContractStore(db: Db) {
  return (
    createDbContractStore(db.eaasContracts) ??
    createJsonContractStore(".data/eaas-contracts.json")
  );
}

export function pickEvalStore(db: Db) {
  return (
    createDbEvalStore(db.eaasEvalJobs) ??
    createJsonEvalStore(".data/eaas-eval-jobs.json")
  );
}

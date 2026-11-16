#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0c1bc30f48fbd4d9e6e1fa4cd5f16a99f2a9ea4811eb1ec19947290e2112a455/contract';
import startContract from '../../snapshots/0c1bc30f48fbd4d9e6e1fa4cd5f16a99f2a9ea4811eb1ec19947290e2112a455/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/174bbe13adcd8dd1ef05efb4b4ab5e7a9b30646347d508ceedf1f228d4298d7b/contract';
import endContract from '../../snapshots/174bbe13adcd8dd1ef05efb4b4ab5e7a9b30646347d508ceedf1f228d4298d7b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'actor',
        columns: [
          col('agentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('did', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('orgId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('passportTokenId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('tier', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('wallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['wallet'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'adminAction',
        columns: [
          col('action', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('evidence', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('operator', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('subjectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('subjectType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'entitlement',
        columns: [
          col('activeSlot', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('idempotencyKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ownerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('productCode', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourcePaymentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('validFromMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('validUntilMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'reconciliationException',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('details', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resolution', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('resolvedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('resolvedBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('subjectRef', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'refundIntent',
        columns: [
          col('amount', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('completedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('completedBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('currency', 'text', {
            notNull: true,
            default: lit('USDC'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('evidence', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('operator', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payee', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('paymentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reason', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('txHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'reputationFact',
        columns: [
          col('actorWallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('atMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('dedupeKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('factType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('sourceRef', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('subjectId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'entitlement',
        constraint: 'entitlement_idempotencyKey_key',
        columns: ['idempotencyKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'entitlement',
        constraint: 'entitlement_activeSlot_key',
        columns: ['activeSlot'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'reputationFact',
        constraint: 'reputationFact_dedupeKey_key',
        columns: ['dedupeKey'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'actor',
        index: 'actor_agentId_idx_8d0ba4f0',
        columns: ['agentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'actor',
        index: 'actor_orgId_idx_c5e5aabe',
        columns: ['orgId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'actor',
        index: 'actor_type_createdAt_idx_00d94001',
        columns: ['type', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adminAction',
        index: 'adminAction_action_createdAtMs_idx_d9318111',
        columns: ['action', 'createdAtMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adminAction',
        index: 'adminAction_operator_createdAtMs_idx_cb0bc76e',
        columns: ['operator', 'createdAtMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adminAction',
        index: 'adminAction_subjectType_subjectId_createdAtMs_idx_15fe9106',
        columns: ['subjectType', 'subjectId', 'createdAtMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'entitlement',
        index: 'entitlement_ownerId_productCode_status_idx_d133f171',
        columns: ['ownerId', 'productCode', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'entitlement',
        index: 'entitlement_sourcePaymentId_idx_423bfc4f',
        columns: ['sourcePaymentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'entitlement',
        index: 'entitlement_status_validUntilMs_idx_3dda2d9c',
        columns: ['status', 'validUntilMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'reconciliationException',
        index: 'reconciliationException_status_createdAtMs_idx_95013a06',
        columns: ['status', 'createdAtMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'reconciliationException',
        index: 'reconciliationException_subjectRef_idx_6307adf9',
        columns: ['subjectRef'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'reconciliationException',
        index: 'reconciliationException_type_createdAtMs_idx_8d1ab589',
        columns: ['type', 'createdAtMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refundIntent',
        index: 'refundIntent_payee_idx_30918ee6',
        columns: ['payee'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refundIntent',
        index: 'refundIntent_paymentId_idx_b2fe9a10',
        columns: ['paymentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refundIntent',
        index: 'refundIntent_status_createdAtMs_idx_95013a06',
        columns: ['status', 'createdAtMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refundIntent',
        index: 'refundIntent_txHash_idx_3fbe8b55',
        columns: ['txHash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'reputationFact',
        index: 'reputationFact_actorWallet_factType_createdAt_idx_0e9b7994',
        columns: ['actorWallet', 'factType', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'reputationFact',
        index: 'reputationFact_sourceRef_idx_f97a6e5c',
        columns: ['sourceRef'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'reputationFact',
        index: 'reputationFact_subjectId_idx_84df2a1d',
        columns: ['subjectId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

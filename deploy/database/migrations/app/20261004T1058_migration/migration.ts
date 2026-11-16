#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0f835062304d587ab0193284ffd553d6e21cc9287c5c6034050dcec9548b5fa9/contract';
import endContract from '../../snapshots/0f835062304d587ab0193284ffd553d6e21cc9287c5c6034050dcec9548b5fa9/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b27c2a0270b519942b2abfc77f8b0fdc532c38bbaa652b63209148514c405a64/contract';
import startContract from '../../snapshots/b27c2a0270b519942b2abfc77f8b0fdc532c38bbaa652b63209148514c405a64/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'delegateRecord',
        columns: [
          col('authorizedAt', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('chain', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('delegate', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ownerWallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('revokedAt', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('spendCapUsd', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'eaasAnchor',
        columns: [
          col('artifactHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('blockNumber', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('lastError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('memoId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('txHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('verdictId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['verdictId'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'eaasContract',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('address', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('chainId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ownerWallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('probedAt', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'eaasEvalJob',
        columns: [
          col('chainId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('contract', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('feedbackTx', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('jobId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('paymentTx', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('verdictId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['key'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'eaasRequest',
        columns: [
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('completedAt', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('reqCreatedAt', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('wallet', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('webhookStatus', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'eaasSubscription',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('expiresAt', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('mintTx', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('paymentTx', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('quotaUsed', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('resetAt', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('tier', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
        table: 'eaasVerdict',
        columns: [
          col('consumerWallet', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('deliverableHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('paymentTx', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('verdictId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['verdictId'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'marketplaceMeta',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('hash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
        ],
        constraints: [primaryKey(['hash'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'marketplaceService',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('serviceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['serviceId'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'event',
        column: col('at', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'event',
        column: col('venueId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'event',
        column: col('wallet', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'delegateRecord',
        index: 'delegateRecord_ownerWallet_idx_63c6ac04',
        columns: ['ownerWallet'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'delegateRecord',
        index: 'delegateRecord_revokedAt_idx_f1d8e6b3',
        columns: ['revokedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'eaasAnchor',
        index: 'eaasAnchor_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'eaasContract',
        index: 'eaasContract_active_idx_8af4daed',
        columns: ['active'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'eaasContract',
        index: 'eaasContract_ownerWallet_idx_63c6ac04',
        columns: ['ownerWallet'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'eaasEvalJob',
        index: 'eaasEvalJob_contract_idx_b7d987ca',
        columns: ['contract'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'eaasEvalJob',
        index: 'eaasEvalJob_verdictId_idx_49590bc8',
        columns: ['verdictId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'eaasRequest',
        index: 'eaasRequest_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'eaasRequest',
        index: 'eaasRequest_wallet_idx_df52cf87',
        columns: ['wallet'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'eaasSubscription',
        index: 'eaasSubscription_expiresAt_idx_6b6b8c10',
        columns: ['expiresAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'eaasVerdict',
        index: 'eaasVerdict_consumerWallet_createdAt_idx_6aaca527',
        columns: ['consumerWallet', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'eaasVerdict',
        index: 'eaasVerdict_deliverableHash_idx_ed37c457',
        columns: ['deliverableHash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'event',
        index: 'event_venueId_at_idx_6ab90d05',
        columns: ['venueId', 'at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'event',
        index: 'event_wallet_at_idx_b76ec1ce',
        columns: ['wallet', 'at'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

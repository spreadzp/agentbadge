#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/03bd70f33f00685e692677ffaf20a36bdf4b860fb17683d7a400db442eee2447/contract';
import endContract from '../../snapshots/03bd70f33f00685e692677ffaf20a36bdf4b860fb17683d7a400db442eee2447/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/a84d100b2b55b78a8ab308f84649f9e05392eab61c064cb5010946534c042b79/contract';
import startContract from '../../snapshots/a84d100b2b55b78a8ab308f84649f9e05392eab61c064cb5010946534c042b79/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'paymentException',
        columns: [
          col('attemptId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('details', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('paymentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('resolutionNote', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('resolvedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('severity', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'usageRecord',
        columns: [
          col('agentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('amount', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
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
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('network', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payerAddress', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('paymentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('requestId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resource', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('txHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'usageRecord',
        constraint: 'usageRecord_requestId_key',
        columns: ['requestId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'paymentException',
        index: 'paymentException_attemptId_idx_94f50eb9',
        columns: ['attemptId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'paymentException',
        index: 'paymentException_kind_idx_c9ca668f',
        columns: ['kind'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'paymentException',
        index: 'paymentException_paymentId_idx_b2fe9a10',
        columns: ['paymentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'paymentException',
        index: 'paymentException_status_createdAtMs_idx_95013a06',
        columns: ['status', 'createdAtMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'usageRecord',
        index: 'usageRecord_agentId_createdAtMs_idx_be65b811',
        columns: ['agentId', 'createdAtMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'usageRecord',
        index: 'usageRecord_payerAddress_idx_de0e56a9',
        columns: ['payerAddress'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'usageRecord',
        index: 'usageRecord_paymentId_idx_b2fe9a10',
        columns: ['paymentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'usageRecord',
        index: 'usageRecord_resource_createdAtMs_idx_0a23f75d',
        columns: ['resource', 'createdAtMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'usageRecord',
        index: 'usageRecord_txHash_idx_3fbe8b55',
        columns: ['txHash'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

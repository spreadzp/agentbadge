#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/9dbca36b71816d7a9f4ca16fd430f30b0ac5c5c076d0fe1d3fb9bab43c4cec17/contract';
import startContract from '../../snapshots/9dbca36b71816d7a9f4ca16fd430f30b0ac5c5c076d0fe1d3fb9bab43c4cec17/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/d20152a2d7adc4b74eaac97190e26e7f3ccb1691f3b6e2045ca4933b53fb1b80/contract';
import endContract from '../../snapshots/d20152a2d7adc4b74eaac97190e26e7f3ccb1691f3b6e2045ca4933b53fb1b80/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'intelBillingEvent',
        columns: [
          col('applied', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('effect', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('externalId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('processedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('provider', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'intelConsentEvent',
        columns: [
          col('action', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('principal', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('principalId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('siteId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'intelEntitlementEvent',
        columns: [
          col('action', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('actor', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('fromStatus', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('plan', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('toStatus', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'intelScanJob',
        column: col('correlationId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelBillingEvent',
        constraint: 'intelBillingEvent_provider_externalId_key',
        columns: ['provider', 'externalId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelBillingEvent',
        index: 'intelBillingEvent_tenantId_idx_c93ed4f1',
        columns: ['tenantId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelConsentEvent',
        index: 'intelConsentEvent_siteId_at_idx_b0aeaa80',
        columns: ['siteId', 'at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelEntitlementEvent',
        index: 'intelEntitlementEvent_tenantId_at_idx_21a9eddd',
        columns: ['tenantId', 'at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelScanJob',
        index: 'intelScanJob_scanId_idx_7c201901',
        columns: ['scanId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

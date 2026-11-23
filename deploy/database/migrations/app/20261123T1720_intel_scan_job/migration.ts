#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/24f19907e9fe698ec1c977b1164ccdd02afc61f44461bb1bc0e38664da6acfc1/contract';
import endContract from '../../snapshots/24f19907e9fe698ec1c977b1164ccdd02afc61f44461bb1bc0e38664da6acfc1/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c05aee82f27b689e8064d42e44faa898c9be15ba75f6439a0867ff1741cc1d1c/contract';
import startContract from '../../snapshots/c05aee82f27b689e8064d42e44faa898c9be15ba75f6439a0867ff1741cc1d1c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'intelScanJob',
        columns: [
          col('baseUrl', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('error', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('finishedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('probeFailures', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('probeTotal', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('report', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('reportId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('scanId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('siteId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelScanJob',
        index: 'intelScanJob_siteId_createdAt_idx_2fcd3bd2',
        columns: ['siteId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelScanJob',
        index: 'intelScanJob_tenantId_idx_c93ed4f1',
        columns: ['tenantId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

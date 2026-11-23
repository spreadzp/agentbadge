#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/3b7b82ce22615f5958f7d7e2d44047f618d8fb7d0c05a7c05882a97130cf48a5/contract';
import startContract from '../../snapshots/3b7b82ce22615f5958f7d7e2d44047f618d8fb7d0c05a7c05882a97130cf48a5/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f77931a1964860f33fa3f46f7c6209f885e7f613298ace482fd7dd45c995e95a/contract';
import endContract from '../../snapshots/f77931a1964860f33fa3f46f7c6209f885e7f613298ace482fd7dd45c995e95a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'intelClientReport',
        columns: [
          col('approvedBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('canonical', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('delta', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('editorial', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('editorialHistory', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('period', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sentAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('sentBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
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
      this.addUnique({
        schema: 'public',
        table: 'intelClientReport',
        constraint: 'intelClientReport_siteId_period_key',
        columns: ['siteId', 'period'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelClientReport',
        index: 'intelClientReport_tenantId_idx_c93ed4f1',
        columns: ['tenantId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2e1c3c464ec1924cd8bc655e4fcea3449b9817e707bc6eaa5bb9a83796d61980/contract';
import startContract from '../../snapshots/2e1c3c464ec1924cd8bc655e4fcea3449b9817e707bc6eaa5bb9a83796d61980/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/3b7b82ce22615f5958f7d7e2d44047f618d8fb7d0c05a7c05882a97130cf48a5/contract';
import endContract from '../../snapshots/3b7b82ce22615f5958f7d7e2d44047f618d8fb7d0c05a7c05882a97130cf48a5/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'intelConsent',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('grantedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('grantedById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('grantedByPrincipal', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('revokedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('siteId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelConsent',
        constraint: 'intelConsent_siteId_kind_key',
        columns: ['siteId', 'kind'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelConsent',
        index: 'intelConsent_siteId_idx_cabdc5ab',
        columns: ['siteId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

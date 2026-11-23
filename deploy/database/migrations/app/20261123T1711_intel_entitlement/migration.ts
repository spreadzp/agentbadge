#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/c05aee82f27b689e8064d42e44faa898c9be15ba75f6439a0867ff1741cc1d1c/contract';
import endContract from '../../snapshots/c05aee82f27b689e8064d42e44faa898c9be15ba75f6439a0867ff1741cc1d1c/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/fcf9d6ed3adc03ee51e0a6f060b9c06a7ad08be20ccfbe9893067a9e35540304/contract';
import startContract from '../../snapshots/fcf9d6ed3adc03ee51e0a6f060b9c06a7ad08be20ccfbe9893067a9e35540304/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'intelEntitlement',
        columns: [
          col('coveredSiteIds', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('graceUntil', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('perSiteLimits', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('plan', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('validFrom', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('validUntil', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelEntitlement',
        constraint: 'intelEntitlement_tenantId_key',
        columns: ['tenantId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

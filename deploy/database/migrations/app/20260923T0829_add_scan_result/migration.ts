#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/48124b261bd99e96c2f53bbf96228825f1680999a8e48caab8690baf5da263fa/contract';
import endContract from '../../snapshots/48124b261bd99e96c2f53bbf96228825f1680999a8e48caab8690baf5da263fa/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/a5ff6d007b451cfd1899c6d722772616290d119afe49050eff5db9569aa23021/contract';
import startContract from '../../snapshots/a5ff6d007b451cfd1899c6d722772616290d119afe49050eff5db9569aa23021/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'scanResult',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('domain', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('report', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('rulesetVersion', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('score', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('url', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'scanResult',
        index: 'scanResult_domain_createdAt_idx_c5bd4696',
        columns: ['domain', 'createdAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

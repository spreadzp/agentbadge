#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/570892a8c43d524d1a9419a371c1ff54e80f72b43afbfd8957c26cfe11eb9557/contract';
import endContract from '../../snapshots/570892a8c43d524d1a9419a371c1ff54e80f72b43afbfd8957c26cfe11eb9557/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/d20152a2d7adc4b74eaac97190e26e7f3ccb1691f3b6e2045ca4933b53fb1b80/contract';
import startContract from '../../snapshots/d20152a2d7adc4b74eaac97190e26e7f3ccb1691f3b6e2045ca4933b53fb1b80/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'knowledgeGapEvent',
        columns: [
          col('actor', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('assignedTo', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('dueAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('gapId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurredAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('previousAssignee', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeGapEvent',
        index: 'knowledgeGapEvent_gapId_occurredAt_idx_f8d605bd',
        columns: ['gapId', 'occurredAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

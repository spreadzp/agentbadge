#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/570892a8c43d524d1a9419a371c1ff54e80f72b43afbfd8957c26cfe11eb9557/contract';
import startContract from '../../snapshots/570892a8c43d524d1a9419a371c1ff54e80f72b43afbfd8957c26cfe11eb9557/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/bae95e243ae4b1ecdad8fbd49caaee81098aed812932f0d3e0d776b10a0f5f1b/contract';
import endContract from '../../snapshots/bae95e243ae4b1ecdad8fbd49caaee81098aed812932f0d3e0d776b10a0f5f1b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'knowledgeGapOverdue',
        columns: [
          col('detectedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('dueAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('emittedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('gapId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'knowledgeGapOverdue',
        constraint: 'knowledgeGapOverdue_gapId_dueAt_key',
        columns: ['gapId', 'dueAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeGapOverdue',
        index: 'knowledgeGapOverdue_emittedAt_idx_4c0cad96',
        columns: ['emittedAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

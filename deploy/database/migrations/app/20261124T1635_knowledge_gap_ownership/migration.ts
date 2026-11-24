#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/9dbca36b71816d7a9f4ca16fd430f30b0ac5c5c076d0fe1d3fb9bab43c4cec17/contract';
import endContract from '../../snapshots/9dbca36b71816d7a9f4ca16fd430f30b0ac5c5c076d0fe1d3fb9bab43c4cec17/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c7f566ab20a8b3c767ae2e6447944c6d0ea632cd24c4079b36eba03b9a4a5b0d/contract';
import startContract from '../../snapshots/c7f566ab20a8b3c767ae2e6447944c6d0ea632cd24c4079b36eba03b9a4a5b0d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'knowledgeGap',
        column: col('assignedAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'knowledgeGap',
        column: col('assignedBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'knowledgeGap',
        column: col('assignedTo', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'knowledgeGap',
        column: col('dueAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'knowledgeGap',
        column: col('resolvedAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeGap',
        index: 'knowledgeGap_assignedTo_status_idx_4cd13cbf',
        columns: ['assignedTo', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeGap',
        index: 'knowledgeGap_status_dueAt_idx_0bd78a2c',
        columns: ['status', 'dueAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

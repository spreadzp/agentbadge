#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/c47f4a413206d1a775d53b05c45f64240b961ea6e0ecca2f2a6d39e78f194f0c/contract';
import endContract from '../../snapshots/c47f4a413206d1a775d53b05c45f64240b961ea6e0ecca2f2a6d39e78f194f0c/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/ea6ecb700c2e968565a7a50845b5a1bf375fb46e38fd535002541031571554cc/contract';
import startContract from '../../snapshots/ea6ecb700c2e968565a7a50845b5a1bf375fb46e38fd535002541031571554cc/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'agentTrustEdge',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('eventCount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('fromAgent', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastEventAt', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastEventSeq', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('toAgent', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('totalUsd', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'agentTrustEdge',
        constraint: 'agentTrustEdge_fromAgent_toAgent_kind_key',
        columns: ['fromAgent', 'toAgent', 'kind'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentTrustEdge',
        index: 'agentTrustEdge_toAgent_lastEventSeq_idx_94a10541',
        columns: ['toAgent', 'lastEventSeq'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

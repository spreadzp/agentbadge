#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2bf60d54acf4ab9abee988ad1a46b4b9438fcbcdd771d4ee9fddd2a97a5f4ebb/contract';
import startContract from '../../snapshots/2bf60d54acf4ab9abee988ad1a46b4b9438fcbcdd771d4ee9fddd2a97a5f4ebb/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/ea6ecb700c2e968565a7a50845b5a1bf375fb46e38fd535002541031571554cc/contract';
import endContract from '../../snapshots/ea6ecb700c2e968565a7a50845b5a1bf375fb46e38fd535002541031571554cc/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'economicEvent',
        columns: [
          col('actor', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('amountUsdc', 'numeric', { codecRef: { codecId: 'pg/numeric@1' } }),
          col('at', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('counterparty', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('idempotencyKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ledgerSeq', 'BIGSERIAL', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('seq', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('spec', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'economicEvent',
        constraint: 'economicEvent_idempotencyKey_key',
        columns: ['idempotencyKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'economicEvent',
        constraint: 'economicEvent_source_sourceId_seq_key',
        columns: ['source', 'sourceId', 'seq'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'economicEvent',
        constraint: 'economicEvent_ledgerSeq_key',
        columns: ['ledgerSeq'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'economicEvent',
        index: 'economicEvent_actor_ledgerSeq_idx_c13dd6fa',
        columns: ['actor', 'ledgerSeq'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'economicEvent',
        index: 'economicEvent_counterparty_ledgerSeq_idx_0c96cd61',
        columns: ['counterparty', 'ledgerSeq'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'economicEvent',
        index: 'economicEvent_kind_ledgerSeq_idx_82590d81',
        columns: ['kind', 'ledgerSeq'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

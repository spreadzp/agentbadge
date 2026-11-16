#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/b27c2a0270b519942b2abfc77f8b0fdc532c38bbaa652b63209148514c405a64/contract';
import endContract from '../../snapshots/b27c2a0270b519942b2abfc77f8b0fdc532c38bbaa652b63209148514c405a64/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b8e32f5ce86590030c6c80c1f24c199aae7daf9a6869951a0b1af2903d31f177/contract';
import startContract from '../../snapshots/b8e32f5ce86590030c6c80c1f24c199aae7daf9a6869951a0b1af2903d31f177/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'spendEvent',
        columns: [
          col('amountUsd', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('at', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('denialReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('refId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceChain', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('state', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('txHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('venueId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('wallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'spendEvent',
        index: 'spendEvent_denialReason_at_idx_84ea573f',
        columns: ['denialReason', 'at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'spendEvent',
        index: 'spendEvent_state_at_idx_b570e6ae',
        columns: ['state', 'at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'spendEvent',
        index: 'spendEvent_txHash_idx_3fbe8b55',
        columns: ['txHash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'spendEvent',
        index: 'spendEvent_venueId_at_idx_6ab90d05',
        columns: ['venueId', 'at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'spendEvent',
        index: 'spendEvent_wallet_at_idx_b76ec1ce',
        columns: ['wallet', 'at'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

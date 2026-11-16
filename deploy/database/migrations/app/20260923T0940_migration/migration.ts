#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/34b23f5aeb2d36a58036b2eadcc94edf8dbcdf7644aa9eae5517ba51d66451df/contract';
import endContract from '../../snapshots/34b23f5aeb2d36a58036b2eadcc94edf8dbcdf7644aa9eae5517ba51d66451df/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/48124b261bd99e96c2f53bbf96228825f1680999a8e48caab8690baf5da263fa/contract';
import startContract from '../../snapshots/48124b261bd99e96c2f53bbf96228825f1680999a8e48caab8690baf5da263fa/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'chatSubscription',
        columns: [
          col('chatId', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('username', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'chatSubscription',
        constraint: 'chatSubscription_chatId_key',
        columns: ['chatId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'chatSubscription',
        constraint: 'chatSubscription_username_key',
        columns: ['username'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

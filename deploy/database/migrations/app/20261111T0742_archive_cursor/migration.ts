#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/00e6f20c31337bbadfdfb5b2620d7c6e3c23d12305ef021a3bb52a91dfb8f721/contract';
import startContract from '../../snapshots/00e6f20c31337bbadfdfb5b2620d7c6e3c23d12305ef021a3bb52a91dfb8f721/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/a84d100b2b55b78a8ab308f84649f9e05392eab61c064cb5010946534c042b79/contract';
import endContract from '../../snapshots/a84d100b2b55b78a8ab308f84649f9e05392eab61c064cb5010946534c042b79/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'archiveCursor',
        columns: [
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastMessageId', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('stream', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('throughAt', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'archiveCursor',
        constraint: 'archiveCursor_stream_key',
        columns: ['stream'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

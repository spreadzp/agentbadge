#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/9cce93a654af753fc1c29c2db0f03834e11196595e8980954075427732bbf3e3/contract';
import startContract from '../../snapshots/9cce93a654af753fc1c29c2db0f03834e11196595e8980954075427732bbf3e3/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/b8e32f5ce86590030c6c80c1f24c199aae7daf9a6869951a0b1af2903d31f177/contract';
import endContract from '../../snapshots/b8e32f5ce86590030c6c80c1f24c199aae7daf9a6869951a0b1af2903d31f177/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'agentWallet',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('address', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('agentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('registeredBy', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('venueId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'agentWallet',
        constraint: 'agentWallet_address_key',
        columns: ['address'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentWallet',
        index: 'agentWallet_active_createdAt_idx_7cd57621',
        columns: ['active', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentWallet',
        index: 'agentWallet_agentId_idx_8d0ba4f0',
        columns: ['agentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentWallet',
        index: 'agentWallet_venueId_active_idx_51915f5b',
        columns: ['venueId', 'active'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1a0ea94a2443f0233b05312efc43fb4de0d183cfa337c395a9bec0a6ca576067/contract';
import startContract from '../../snapshots/1a0ea94a2443f0233b05312efc43fb4de0d183cfa337c395a9bec0a6ca576067/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/d1898083679b7bac6b61bca8cbe27d0aacdc227856101b31d26b8622d91b0251/contract';
import endContract from '../../snapshots/d1898083679b7bac6b61bca8cbe27d0aacdc227856101b31d26b8622d91b0251/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'webhookOutbox',
        columns: [
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('callbackUrl', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('lockedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('nextAttemptAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('requestId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('queued'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentRequest',
        column: col('callbackUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'webhookOutbox',
        constraint: 'webhookOutbox_requestId_key',
        columns: ['requestId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'webhookOutbox',
        index: 'webhookOutbox_status_nextAttemptAtMs_idx_73aed880',
        columns: ['status', 'nextAttemptAtMs'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/bd5320ac2cc47ee11b63a2933307aa4f940b5e3a06e91f678ef66de79d8d7b8e/contract';
import endContract from '../../snapshots/bd5320ac2cc47ee11b63a2933307aa4f940b5e3a06e91f678ef66de79d8d7b8e/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f77931a1964860f33fa3f46f7c6209f885e7f613298ace482fd7dd45c995e95a/contract';
import startContract from '../../snapshots/f77931a1964860f33fa3f46f7c6209f885e7f613298ace482fd7dd45c995e95a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'adminOperator',
        columns: [
          col('capabilities', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('disabledAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('displayName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('principalType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('active'),
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'adminOperatorCredential',
        columns: [
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('issuedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('keyHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('keyPrefix', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastUsedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('operatorId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('revokedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('active'),
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'adminOperatorCredential',
        constraint: 'adminOperatorCredential_keyHash_key',
        columns: ['keyHash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adminOperator',
        index: 'adminOperator_principalType_status_idx_2577b345',
        columns: ['principalType', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adminOperatorCredential',
        index: 'adminOperatorCredential_lastUsedAt_idx_fee97fdf',
        columns: ['lastUsedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'adminOperatorCredential',
        index: 'adminOperatorCredential_operatorId_status_idx_0096ad1f',
        columns: ['operatorId', 'status'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

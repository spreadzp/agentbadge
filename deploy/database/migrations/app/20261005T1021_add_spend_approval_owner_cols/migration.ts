#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0f835062304d587ab0193284ffd553d6e21cc9287c5c6034050dcec9548b5fa9/contract';
import startContract from '../../snapshots/0f835062304d587ab0193284ffd553d6e21cc9287c5c6034050dcec9548b5fa9/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f6ed86f749de40634b0e1d780fc73776b5156edd40dc9839cf1d94826cce653b/contract';
import endContract from '../../snapshots/f6ed86f749de40634b0e1d780fc73776b5156edd40dc9839cf1d94826cce653b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'spendApproval',
        columns: [
          col('amountUsd', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('consumedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('decidedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('decidedBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('expiresAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('refId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('state', 'text', {
            notNull: true,
            default: lit('pending'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('venueId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('wallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentWallet',
        column: col('allowedKinds', 'json', { codecRef: { codecId: 'pg/json@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentWallet',
        column: col('approvalAboveUsd', 'numeric', { codecRef: { codecId: 'pg/numeric@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentWallet',
        column: col('maxAmountPerHour', 'numeric', { codecRef: { codecId: 'pg/numeric@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentWallet',
        column: col('maxTxPerHour', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentWallet',
        column: col('suspended', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentWallet',
        column: col('suspendedAt', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentWallet',
        column: col('suspendedBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'spendApproval',
        index: 'spendApproval_wallet_createdAtMs_idx_70458d62',
        columns: ['wallet', 'createdAtMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'spendApproval',
        index: 'spendApproval_wallet_state_idx_68707ee0',
        columns: ['wallet', 'state'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

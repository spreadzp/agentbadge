#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2bf60d54acf4ab9abee988ad1a46b4b9438fcbcdd771d4ee9fddd2a97a5f4ebb/contract';
import endContract from '../../snapshots/2bf60d54acf4ab9abee988ad1a46b4b9438fcbcdd771d4ee9fddd2a97a5f4ebb/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/973ade5d1e71035a5869ee0a0f28e11065999e543b7d8dcaa1528190775181f3/contract';
import startContract from '../../snapshots/973ade5d1e71035a5869ee0a0f28e11065999e543b7d8dcaa1528190775181f3/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'forensicsCursor',
        columns: [
          col('chain', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastBlock', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'forensicsEdge',
        columns: [
          col('amountAtomic', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('blockNumber', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('chain', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payer', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('seller', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ts', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('txHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'forensicsFunding',
        columns: [
          col('blockNumber', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('chain', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('funded', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('funder', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('isPublicSource', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('sourceKind', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('txHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'forensicsCursor',
        constraint: 'forensicsCursor_chain_key',
        columns: ['chain'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'forensicsEdge',
        constraint: 'forensicsEdge_chain_txHash_payer_seller_key',
        columns: ['chain', 'txHash', 'payer', 'seller'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'forensicsFunding',
        constraint: 'forensicsFunding_chain_funded_key',
        columns: ['chain', 'funded'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forensicsEdge',
        index: 'forensicsEdge_chain_payer_idx_5562e861',
        columns: ['chain', 'payer'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forensicsEdge',
        index: 'forensicsEdge_chain_seller_blockNumber_idx_cdb637ae',
        columns: ['chain', 'seller', 'blockNumber'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'forensicsFunding',
        index: 'forensicsFunding_chain_funder_idx_03f1cda3',
        columns: ['chain', 'funder'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

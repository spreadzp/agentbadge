#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/7b39bf54b1f345dd0eb5a268bedbf2a8ce145c90ee077000d4d7c98b3bce8894/contract';
import startContract from '../../snapshots/7b39bf54b1f345dd0eb5a268bedbf2a8ce145c90ee077000d4d7c98b3bce8894/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/fcf9d6ed3adc03ee51e0a6f060b9c06a7ad08be20ccfbe9893067a9e35540304/contract';
import endContract from '../../snapshots/fcf9d6ed3adc03ee51e0a6f060b9c06a7ad08be20ccfbe9893067a9e35540304/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'intelEnvelope',
        columns: [
          col('collectorId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('dedupeHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('envelope', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('expiresAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('provenance', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('receivedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('scanId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('schemaVersion', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('siteId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelEnvelope',
        constraint: 'intelEnvelope_dedupeHash_key',
        columns: ['dedupeHash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelEnvelope',
        index: 'intelEnvelope_expiresAt_idx_6b6b8c10',
        columns: ['expiresAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelEnvelope',
        index: 'intelEnvelope_scanId_idx_7c201901',
        columns: ['scanId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelEnvelope',
        index: 'intelEnvelope_siteId_receivedAt_idx_f6304c44',
        columns: ['siteId', 'receivedAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

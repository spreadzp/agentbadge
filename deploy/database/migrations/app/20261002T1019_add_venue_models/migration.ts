#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/34b23f5aeb2d36a58036b2eadcc94edf8dbcdf7644aa9eae5517ba51d66451df/contract';
import startContract from '../../snapshots/34b23f5aeb2d36a58036b2eadcc94edf8dbcdf7644aa9eae5517ba51d66451df/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/9cce93a654af753fc1c29c2db0f03834e11196595e8980954075427732bbf3e3/contract';
import endContract from '../../snapshots/9cce93a654af753fc1c29c2db0f03834e11196595e8980954075427732bbf3e3/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'venueJob',
        columns: [
          col('client', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('jobId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('provider', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'venueMeta',
        columns: [
          col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('value', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
        ],
        constraints: [primaryKey(['key'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'venueOffer',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('providerAddress', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'venueJob',
        constraint: 'venueJob_jobId_key',
        columns: ['jobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'venueJob',
        index: 'venueJob_client_idx_135b7ce5',
        columns: ['client'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'venueJob',
        index: 'venueJob_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'venueOffer',
        index: 'venueOffer_providerAddress_active_idx_bf5e414c',
        columns: ['providerAddress', 'active'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

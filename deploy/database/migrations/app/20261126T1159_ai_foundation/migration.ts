#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/5e6a3a552a574fa5dee78118c5afa2d9e522da4b96877cda3796d0e4ec272b9d/contract';
import endContract from '../../snapshots/5e6a3a552a574fa5dee78118c5afa2d9e522da4b96877cda3796d0e4ec272b9d/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/61bb8121238ceb76c3df38f88dcfc03781e7dc06e6f36383ab0447c300174e7e/contract';
import startContract from '../../snapshots/61bb8121238ceb76c3df38f88dcfc03781e7dc06e6f36383ab0447c300174e7e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'aiJob',
        columns: [
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('idempotencyKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('inputHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('inputRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('lastError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('lockedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('runId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('scenario', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('queued'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('subjectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('subjectType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'aiRun',
        columns: [
          col('confidence', 'float8', { codecRef: { codecId: 'pg/float8@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('error', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('inputHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('inputRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('jobId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('latencyMs', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('modeAtTime', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('model', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('output', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('promptVersion', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('provider', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('scenario', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('subjectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('subjectType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tokensTotal', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('usage', 'json', { codecRef: { codecId: 'pg/json@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'automationPolicy',
        columns: [
          col('confidenceThreshold', 'float8', { codecRef: { codecId: 'pg/float8@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mode', 'text', {
            notNull: true,
            default: lit('off'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('model', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('scenario', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('updatedBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'policyChange',
        columns: [
          col('actor', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('field', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('newValue', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('oldValue', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('scenario', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'aiJob',
        constraint: 'aiJob_idempotencyKey_key',
        columns: ['idempotencyKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'automationPolicy',
        constraint: 'automationPolicy_scenario_key',
        columns: ['scenario'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'aiJob',
        index: 'aiJob_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'aiJob',
        index: 'aiJob_subjectType_subjectId_idx_34976a96',
        columns: ['subjectType', 'subjectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'aiRun',
        index: 'aiRun_scenario_createdAt_idx_3cc554d6',
        columns: ['scenario', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'aiRun',
        index: 'aiRun_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'aiRun',
        index: 'aiRun_subjectType_subjectId_createdAt_idx_9ad5362a',
        columns: ['subjectType', 'subjectId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'policyChange',
        index: 'policyChange_scenario_createdAt_idx_3cc554d6',
        columns: ['scenario', 'createdAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

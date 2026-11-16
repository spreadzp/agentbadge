#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/03bd70f33f00685e692677ffaf20a36bdf4b860fb17683d7a400db442eee2447/contract';
import startContract from '../../snapshots/03bd70f33f00685e692677ffaf20a36bdf4b860fb17683d7a400db442eee2447/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/ce3dbc982e847a806062a4801576fae3198b8816f91dc6805498b6bf7626a45d/contract';
import endContract from '../../snapshots/ce3dbc982e847a806062a4801576fae3198b8816f91dc6805498b6bf7626a45d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'agentQAPair',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('question', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('questionHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('response', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('sourceRequestId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('uses', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'agentRequest',
        columns: [
          col('agentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('expiresAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('fingerprint', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('fpHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('idempotencyKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('respondedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('response', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('spamFlag', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('state', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('verified', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'agentSurvey',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('closesAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('questions', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'surveyAnswer',
        columns: [
          col('agentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('answers', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('fpHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('rated', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('surveyId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'agentQAPair',
        constraint: 'agentQAPair_questionHash_key',
        columns: ['questionHash'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'agentRequest',
        constraint: 'agentRequest_idempotencyKey_fpHash_key',
        columns: ['idempotencyKey', 'fpHash'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'surveyAnswer',
        constraint: 'surveyAnswer_surveyId_agentId_key',
        columns: ['surveyId', 'agentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentQAPair',
        index: 'agentQAPair_question_idx_191eccf6',
        columns: ['question'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentQAPair',
        index: 'agentQAPair_sourceRequestId_idx_949a5766',
        columns: ['sourceRequestId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentRequest',
        index: 'agentRequest_agentId_idx_8d0ba4f0',
        columns: ['agentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentRequest',
        index: 'agentRequest_expiresAtMs_idx_89d46aa4',
        columns: ['expiresAtMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentRequest',
        index: 'agentRequest_fpHash_idx_7a44a30a',
        columns: ['fpHash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentRequest',
        index: 'agentRequest_state_createdAt_idx_f9712fdb',
        columns: ['state', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentSurvey',
        index: 'agentSurvey_active_createdAt_idx_7cd57621',
        columns: ['active', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'surveyAnswer',
        index: 'surveyAnswer_surveyId_fpHash_idx_114d0920',
        columns: ['surveyId', 'fpHash'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

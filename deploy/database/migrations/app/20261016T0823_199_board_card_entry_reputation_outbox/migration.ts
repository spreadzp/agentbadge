#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2c329a54c2f1698aa434bd4fe3674d5c1cda601081cd8f3bd9e53a2dcb6dd5fa/contract';
import endContract from '../../snapshots/2c329a54c2f1698aa434bd4fe3674d5c1cda601081cd8f3bd9e53a2dcb6dd5fa/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/bf6c29ecb1a0db37371b72078861dfe63f1e59f3df6cd8f420a211d639f9e37f/contract';
import startContract from '../../snapshots/bf6c29ecb1a0db37371b72078861dfe63f1e59f3df6cd8f420a211d639f9e37f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'boardCard',
        columns: [
          col('bountyId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('budgetUsdc', 'numeric', { codecRef: { codecId: 'pg/numeric@1' } }),
          col('cardId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('column', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('currentPassportId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('fixDeadlineMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('specHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['cardId'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'boardEntry',
        columns: [
          col('actor', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('atMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('attempt', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('cardId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('seq', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('txHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'chainTxOutbox',
        columns: [
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('cardId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('idempotencyKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('jobAttempt', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('txHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'reputationWrite',
        columns: [
          col('agentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
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
          col('feedbackHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('feedbackUri', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('jobAttempt', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('passportId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('score', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('sourceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('txHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'boardCard',
        constraint: 'boardCard_bountyId_key',
        columns: ['bountyId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'boardEntry',
        constraint: 'boardEntry_cardId_seq_key',
        columns: ['cardId', 'seq'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'chainTxOutbox',
        constraint: 'chainTxOutbox_idempotencyKey_key',
        columns: ['idempotencyKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'reputationWrite',
        constraint: 'reputationWrite_sourceType_sourceId_jobAttempt_key',
        columns: ['sourceType', 'sourceId', 'jobAttempt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'boardCard',
        index: 'boardCard_column_createdAt_idx_c11dd38f',
        columns: ['column', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'boardCard',
        index: 'boardCard_currentPassportId_idx_74315c25',
        columns: ['currentPassportId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'boardCard',
        index: 'boardCard_fixDeadlineMs_idx_16e741bf',
        columns: ['fixDeadlineMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'boardEntry',
        index: 'boardEntry_cardId_atMs_idx_7d4652e6',
        columns: ['cardId', 'atMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'boardEntry',
        index: 'boardEntry_kind_atMs_idx_c87599e9',
        columns: ['kind', 'atMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'chainTxOutbox',
        index: 'chainTxOutbox_cardId_idx_c511c1e1',
        columns: ['cardId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'chainTxOutbox',
        index: 'chainTxOutbox_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'reputationWrite',
        index: 'reputationWrite_agentId_idx_8d0ba4f0',
        columns: ['agentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'reputationWrite',
        index: 'reputationWrite_passportId_createdAt_idx_a5f8836c',
        columns: ['passportId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'reputationWrite',
        index: 'reputationWrite_status_updatedAt_idx_29f913bb',
        columns: ['status', 'updatedAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

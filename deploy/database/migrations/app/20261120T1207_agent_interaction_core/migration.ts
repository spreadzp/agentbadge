#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/9b0a6a551178ff5e38798a34f47ad09fe1fe10047d838252bfb40a113c4f8a31/contract';
import startContract from '../../snapshots/9b0a6a551178ff5e38798a34f47ad09fe1fe10047d838252bfb40a113c4f8a31/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/fb111c796948c0c2daa1c7b70adbbacec44f4d2c77598a081e1fe7900cf9884d/contract';
import endContract from '../../snapshots/fb111c796948c0c2daa1c7b70adbbacec44f4d2c77598a081e1fe7900cf9884d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'interactionEvent',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('requestId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('seq', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('visibility', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'interactionResponse',
        columns: [
          col('body', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('operatorRef', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('requestId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'interactionSession',
        columns: [
          col('actorRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('firstSeenAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastSeenAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('requestCount', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
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
        column: col('actorRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentRequest',
        column: col('actorResolution', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentRequest',
        column: col('channel', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentRequest',
        column: col('classifiedBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentRequest',
        column: col('demandSignals', 'json', { codecRef: { codecId: 'pg/json@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentRequest',
        column: col('entities', 'json', { codecRef: { codecId: 'pg/json@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentRequest',
        column: col('intent', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentRequest',
        column: col('knowledgeGap', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentRequest',
        column: col('outcome', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentRequest',
        column: col('sessionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentRequest',
        column: col('signalType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentRequest',
        column: col('topics', 'json', { codecRef: { codecId: 'pg/json@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'interactionEvent',
        constraint: 'interactionEvent_requestId_seq_key',
        columns: ['requestId', 'seq'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentRequest',
        index: 'agentRequest_actorRef_idx_da577f54',
        columns: ['actorRef'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentRequest',
        index: 'agentRequest_actorResolution_idx_42e62734',
        columns: ['actorResolution'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentRequest',
        index: 'agentRequest_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'interactionEvent',
        index: 'interactionEvent_kind_idx_c9ca668f',
        columns: ['kind'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'interactionResponse',
        index: 'interactionResponse_requestId_idx_fd667f92',
        columns: ['requestId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'interactionSession',
        index: 'interactionSession_actorRef_idx_da577f54',
        columns: ['actorRef'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

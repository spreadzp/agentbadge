#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1931ea48e1bdc8d0548abd5695e703742c78c0729bade76330bffcb317acd416/contract';
import startContract from '../../snapshots/1931ea48e1bdc8d0548abd5695e703742c78c0729bade76330bffcb317acd416/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c76f6974e66e3f1bf2c136c169ac23e83ab6de8511f39d421d2fe2ce4bf8662c/contract';
import endContract from '../../snapshots/c76f6974e66e3f1bf2c136c169ac23e83ab6de8511f39d421d2fe2ce4bf8662c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'feedback',
        columns: [
          col('actorRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('actorResolution', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('closedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('dedupeScope', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('idempotencyKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('knowledgeConverted', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('knowledgeItemId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('normalized', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('relatedCount', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('relatedFeedbackId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('severity', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('suggestion', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('target', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('text', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('triagedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'feedbackEvent',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('feedbackId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('seq', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('visibility', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'reviewCase',
        columns: [
          col('actorRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('actorResolution', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('agentCriteria', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('assignee', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('claimedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('decidedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('declineReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('dedupeScope', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('deliveredAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('idempotencyKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('knowledgeConverted', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('knowledgeItemId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('latestDecisionSeq', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('reopenCount', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('reviewType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('workRef', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'reviewDecision',
        columns: [
          col('criteriaResults', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('decidedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('decidedBy', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('outcome', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reviewId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('seq', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('summary', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'reviewEvent',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('reviewId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('seq', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('visibility', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'reviewEvidence',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('label', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reviewId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('submittedBy', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('uri', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'feedback',
        constraint: 'feedback_idempotencyKey_dedupeScope_key',
        columns: ['idempotencyKey', 'dedupeScope'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'feedbackEvent',
        constraint: 'feedbackEvent_feedbackId_seq_key',
        columns: ['feedbackId', 'seq'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'reviewCase',
        constraint: 'reviewCase_idempotencyKey_dedupeScope_key',
        columns: ['idempotencyKey', 'dedupeScope'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'reviewDecision',
        constraint: 'reviewDecision_reviewId_seq_key',
        columns: ['reviewId', 'seq'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'reviewEvent',
        constraint: 'reviewEvent_reviewId_seq_key',
        columns: ['reviewId', 'seq'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'feedback',
        index: 'feedback_actorRef_idx_da577f54',
        columns: ['actorRef'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'feedback',
        index: 'feedback_normalized_idx_323bea3e',
        columns: ['normalized'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'feedback',
        index: 'feedback_relatedFeedbackId_idx_1063a6bb',
        columns: ['relatedFeedbackId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'feedback',
        index: 'feedback_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'feedbackEvent',
        index: 'feedbackEvent_kind_idx_c9ca668f',
        columns: ['kind'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'reviewCase',
        index: 'reviewCase_actorRef_idx_da577f54',
        columns: ['actorRef'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'reviewCase',
        index: 'reviewCase_assignee_idx_3f8c0463',
        columns: ['assignee'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'reviewCase',
        index: 'reviewCase_reviewType_idx_916784d4',
        columns: ['reviewType'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'reviewCase',
        index: 'reviewCase_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'reviewDecision',
        index: 'reviewDecision_reviewId_idx_2f51da17',
        columns: ['reviewId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'reviewEvent',
        index: 'reviewEvent_kind_idx_c9ca668f',
        columns: ['kind'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'reviewEvidence',
        index: 'reviewEvidence_reviewId_idx_2f51da17',
        columns: ['reviewId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

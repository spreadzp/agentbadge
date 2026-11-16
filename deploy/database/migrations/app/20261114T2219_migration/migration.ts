#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/ce3dbc982e847a806062a4801576fae3198b8816f91dc6805498b6bf7626a45d/contract';
import startContract from '../../snapshots/ce3dbc982e847a806062a4801576fae3198b8816f91dc6805498b6bf7626a45d/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e0d9ff4a57e0b7753ed22534b8a062014b4150a40fabd7a5383c503c6a8b0b8d/contract';
import endContract from '../../snapshots/e0d9ff4a57e0b7753ed22534b8a062014b4150a40fabd7a5383c503c6a8b0b8d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'commerceAgreement',
        columns: [
          col('acceptanceCriteria', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('agreedAmount', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('buyerWallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('completedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('currency', 'text', {
            notNull: true,
            default: lit('USD'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('offerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('providerWallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('taskId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'commerceEvent',
        columns: [
          col('actorWallet', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('entityId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('entityType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('eventSeq', 'BIGSERIAL', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('eventType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('hash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('prevHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'commerceEvidence',
        columns: [
          col('agreementId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('content', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('hash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('metadata', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('submissionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('url', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'commerceOffer',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('currency', 'text', {
            notNull: true,
            default: lit('USD'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('eta', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('price', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('proposal', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('providerAgentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('providerWallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('taskId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'commercePayment',
        columns: [
          col('agreementId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('amount', 'numeric', { codecRef: { codecId: 'pg/numeric@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('currency', 'text', {
            notNull: true,
            default: lit('USD'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mode', 'text', {
            notNull: true,
            default: lit('RECORD_ONLY'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('paymentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('recordedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('recordedBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('verifiedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('verifiedBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'commerceSubmission',
        columns: [
          col('agreementId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('providerWallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resultUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reviewNote', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reviewedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('submittedAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('summary', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'commerceTask',
        columns: [
          col('budget', 'numeric', { codecRef: { codecId: 'pg/numeric@1' } }),
          col('buyerAgentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('buyerWallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('currency', 'text', {
            notNull: true,
            default: lit('USD'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('description', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('expiresAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('requirements', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'commerceAgreement',
        constraint: 'commerceAgreement_taskId_key',
        columns: ['taskId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'commerceAgreement',
        constraint: 'commerceAgreement_offerId_key',
        columns: ['offerId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'commerceEvent',
        constraint: 'commerceEvent_eventSeq_key',
        columns: ['eventSeq'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'commercePayment',
        constraint: 'commercePayment_agreementId_key',
        columns: ['agreementId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceAgreement',
        index: 'commerceAgreement_buyerWallet_idx_1d31fe7c',
        columns: ['buyerWallet'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceAgreement',
        index: 'commerceAgreement_providerWallet_idx_fa866d84',
        columns: ['providerWallet'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceAgreement',
        index: 'commerceAgreement_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceEvent',
        index: 'commerceEvent_entityType_entityId_eventSeq_idx_97af9b5d',
        columns: ['entityType', 'entityId', 'eventSeq'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceEvent',
        index: 'commerceEvent_eventType_eventSeq_idx_c614719e',
        columns: ['eventType', 'eventSeq'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceEvent',
        index: 'commerceEvent_hash_idx_d25bc543',
        columns: ['hash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceEvidence',
        index: 'commerceEvidence_agreementId_idx_ab6426ca',
        columns: ['agreementId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceEvidence',
        index: 'commerceEvidence_submissionId_idx_89cd3f4e',
        columns: ['submissionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceEvidence',
        index: 'commerceEvidence_type_idx_b6b604ea',
        columns: ['type'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceOffer',
        index: 'commerceOffer_providerWallet_createdAt_idx_06369974',
        columns: ['providerWallet', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceOffer',
        index: 'commerceOffer_taskId_status_idx_2ab445eb',
        columns: ['taskId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commercePayment',
        index: 'commercePayment_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceSubmission',
        index: 'commerceSubmission_agreementId_createdAt_idx_2d9f80d4',
        columns: ['agreementId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceSubmission',
        index: 'commerceSubmission_providerWallet_idx_fa866d84',
        columns: ['providerWallet'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceSubmission',
        index: 'commerceSubmission_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceTask',
        index: 'commerceTask_buyerAgentId_idx_2205cb37',
        columns: ['buyerAgentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceTask',
        index: 'commerceTask_buyerWallet_createdAt_idx_081de507',
        columns: ['buyerWallet', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceTask',
        index: 'commerceTask_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

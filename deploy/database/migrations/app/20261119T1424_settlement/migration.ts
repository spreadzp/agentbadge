#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0a3ebb89baf34c26e2199b84f1b23ea0416e64efec0cd3f67a1405678aeda779/contract';
import endContract from '../../snapshots/0a3ebb89baf34c26e2199b84f1b23ea0416e64efec0cd3f67a1405678aeda779/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/5cc05c7580b7916ed4b358c580b28b24d76b9c2825fbe72c359888fb6df0a582/contract';
import startContract from '../../snapshots/5cc05c7580b7916ed4b358c580b28b24d76b9c2825fbe72c359888fb6df0a582/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'dispute',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('evidenceRefs', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('raisedBy', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reason', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resolution', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('resolvedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('resolvedBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('resolverRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('splitAmounts', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('subjectRef', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
        table: 'milestone',
        columns: [
          col('acceptanceCriteria', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('amountUsd', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('dueAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('escrowRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('milestoneId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('planId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('releasePolicy', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('seq', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('submissionRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
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
        table: 'milestonePlan',
        columns: [
          col('agreementRef', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('buyerWallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('currency', 'text', {
            notNull: true,
            default: lit('USDC'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('providerWallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('totalUsd', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'payoutIntent',
        columns: [
          col('completedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('completedBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('executor', 'text', {
            notNull: true,
            default: lit('MANUAL'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('milestoneRef', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
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
        table: 'payoutLeg',
        columns: [
          col('amountUsdc', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('completedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('completedBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('intentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('network', 'text', {
            notNull: true,
            default: lit('arc'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('payee', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('role', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
        table: 'settlementAnchor',
        columns: [
          col('anchoredAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('chainId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('receiptHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('receiptRef', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
        table: 'milestone',
        constraint: 'milestone_planId_milestoneId_key',
        columns: ['planId', 'milestoneId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'milestonePlan',
        constraint: 'milestonePlan_agreementRef_key',
        columns: ['agreementRef'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'payoutIntent',
        constraint: 'payoutIntent_milestoneRef_key',
        columns: ['milestoneRef'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'payoutLeg',
        constraint: 'payoutLeg_network_txHash_key',
        columns: ['network', 'txHash'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'settlementAnchor',
        constraint: 'settlementAnchor_receiptRef_key',
        columns: ['receiptRef'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dispute',
        index: 'dispute_status_createdAtMs_idx_95013a06',
        columns: ['status', 'createdAtMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dispute',
        index: 'dispute_subjectType_subjectRef_idx_aacae306',
        columns: ['subjectType', 'subjectRef'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'milestone',
        index: 'milestone_planId_seq_idx_67ae955b',
        columns: ['planId', 'seq'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'milestone',
        index: 'milestone_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'milestonePlan',
        index: 'milestonePlan_buyerWallet_idx_1d31fe7c',
        columns: ['buyerWallet'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'milestonePlan',
        index: 'milestonePlan_providerWallet_idx_fa866d84',
        columns: ['providerWallet'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'milestonePlan',
        index: 'milestonePlan_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'payoutIntent',
        index: 'payoutIntent_status_createdAtMs_idx_95013a06',
        columns: ['status', 'createdAtMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'payoutLeg',
        index: 'payoutLeg_intentId_idx_e8967b69',
        columns: ['intentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'payoutLeg',
        index: 'payoutLeg_payee_idx_30918ee6',
        columns: ['payee'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'payoutLeg',
        index: 'payoutLeg_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'settlementAnchor',
        index: 'settlementAnchor_status_idx_e98638ab',
        columns: ['status'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

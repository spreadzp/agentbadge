#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/bf6c29ecb1a0db37371b72078861dfe63f1e59f3df6cd8f420a211d639f9e37f/contract';
import endContract from '../../snapshots/bf6c29ecb1a0db37371b72078861dfe63f1e59f3df6cd8f420a211d639f9e37f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f6ed86f749de40634b0e1d780fc73776b5156edd40dc9839cf1d94826cce653b/contract';
import startContract from '../../snapshots/f6ed86f749de40634b0e1d780fc73776b5156edd40dc9839cf1d94826cce653b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'bounty',
        columns: [
          col('bountyId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('budgetUsdc', 'numeric', { codecRef: { codecId: 'pg/numeric@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('jobAttempt', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('onchainJobId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['bountyId'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'bountyClaim',
        columns: [
          col('bountyId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('claimedAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('jobAttempt', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('leaseUntilMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('passportId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('payoutWallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('state', 'text', {
            notNull: true,
            default: lit('open'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'bountyOutcome',
        columns: [
          col('bountyId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('commitSha', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('jobAttempt', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('passportId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('reasonCodes', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('verdict', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('verdictMemoTx', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('verdictRejectTx', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'bountyTransition',
        columns: [
          col('actor', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('atMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('bountyId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('from', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('to', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'passportOwner',
        columns: [
          col('blockNumber', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('logIndex', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('owner', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('passportId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['passportId'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'bountyClaim',
        constraint: 'bountyClaim_bountyId_jobAttempt_key',
        columns: ['bountyId', 'jobAttempt'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'bountyOutcome',
        constraint: 'bountyOutcome_bountyId_jobAttempt_key',
        columns: ['bountyId', 'jobAttempt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'bounty',
        index: 'bounty_onchainJobId_idx_83264b2c',
        columns: ['onchainJobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'bounty',
        index: 'bounty_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'bountyClaim',
        index: 'bountyClaim_passportId_createdAt_idx_a5f8836c',
        columns: ['passportId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'bountyClaim',
        index: 'bountyClaim_state_leaseUntilMs_idx_adce2f36',
        columns: ['state', 'leaseUntilMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'bountyOutcome',
        index: 'bountyOutcome_passportId_createdAt_idx_a5f8836c',
        columns: ['passportId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'bountyOutcome',
        index: 'bountyOutcome_verdict_createdAt_idx_f4d0e5d2',
        columns: ['verdict', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'bountyTransition',
        index: 'bountyTransition_bountyId_atMs_idx_ef8ffca4',
        columns: ['bountyId', 'atMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'passportOwner',
        index: 'passportOwner_owner_idx_01158e2c',
        columns: ['owner'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

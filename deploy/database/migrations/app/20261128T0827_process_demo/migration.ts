#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/d1898083679b7bac6b61bca8cbe27d0aacdc227856101b31d26b8622d91b0251/contract';
import startContract from '../../snapshots/d1898083679b7bac6b61bca8cbe27d0aacdc227856101b31d26b8622d91b0251/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/eec9c2ce07470875b45614074c3c244a64d271ad91d8eb9fd45ccc2864b0d0b4/contract';
import endContract from '../../snapshots/eec9c2ce07470875b45614074c3c244a64d271ad91d8eb9fd45ccc2864b0d0b4/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'processDemoAgent',
        columns: [
          col('agentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('capabilities', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('githubIdentity', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('payoutWallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('provider', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('runtime', 'text', { codecRef: { codecId: 'pg/text@1' } }),
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
        table: 'processDemoAssignment',
        columns: [
          col('agentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('assignedAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('assignedBy', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('idempotencyKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('role', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
        table: 'processDemoExecution',
        columns: [
          col('agentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('assignedWallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('assignmentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('closedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('githubIdentity', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('iteration', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('provider', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('recipientChangeAuditId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('runtime', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('startedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('state', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('stateReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('submittedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
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
        table: 'processDemoTask',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('createdBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('spec', 'json', { codecRef: { codecId: 'pg/json@1' } }),
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
        table: 'processDemoAgent',
        constraint: 'processDemoAgent_agentId_key',
        columns: ['agentId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'processDemoAssignment',
        constraint: 'processDemoAssignment_idempotencyKey_key',
        columns: ['idempotencyKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'processDemoExecution',
        constraint: 'processDemoExecution_assignmentId_key',
        columns: ['assignmentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'processDemoAgent',
        index: 'processDemoAgent_githubIdentity_idx_0cff2fea',
        columns: ['githubIdentity'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'processDemoAgent',
        index: 'processDemoAgent_provider_idx_faf3af28',
        columns: ['provider'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'processDemoAgent',
        index: 'processDemoAgent_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'processDemoAssignment',
        index: 'processDemoAssignment_agentId_status_idx_816a66ac',
        columns: ['agentId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'processDemoAssignment',
        index: 'processDemoAssignment_taskId_role_status_idx_534b79eb',
        columns: ['taskId', 'role', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'processDemoExecution',
        index: 'processDemoExecution_agentId_state_idx_a157e7fb',
        columns: ['agentId', 'state'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'processDemoExecution',
        index: 'processDemoExecution_state_createdAt_idx_f9712fdb',
        columns: ['state', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'processDemoExecution',
        index: 'processDemoExecution_taskId_state_idx_e8b19231',
        columns: ['taskId', 'state'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'processDemoTask',
        index: 'processDemoTask_projectId_status_idx_57a5993e',
        columns: ['projectId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'processDemoTask',
        index: 'processDemoTask_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

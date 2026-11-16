#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2c329a54c2f1698aa434bd4fe3674d5c1cda601081cd8f3bd9e53a2dcb6dd5fa/contract';
import startContract from '../../snapshots/2c329a54c2f1698aa434bd4fe3674d5c1cda601081cd8f3bd9e53a2dcb6dd5fa/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/973ade5d1e71035a5869ee0a0f28e11065999e543b7d8dcaa1528190775181f3/contract';
import endContract from '../../snapshots/973ade5d1e71035a5869ee0a0f28e11065999e543b7d8dcaa1528190775181f3/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'a2AArtifact',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('partsJson', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('taskId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'a2AMessage',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('fromAgentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('partsJson', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('readAt', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('role', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('taskId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('toAgentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'a2ATask',
        columns: [
          col('anchorSeq', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('anchoredAt', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('contextId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ownerAgentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenant', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'a2AArtifact',
        index: 'a2AArtifact_taskId_idx_4965c936',
        columns: ['taskId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'a2AMessage',
        index: 'a2AMessage_fromAgentId_idx_f948ee59',
        columns: ['fromAgentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'a2AMessage',
        index: 'a2AMessage_taskId_idx_4965c936',
        columns: ['taskId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'a2AMessage',
        index: 'a2AMessage_toAgentId_readAt_idx_5be374e1',
        columns: ['toAgentId', 'readAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'a2ATask',
        index: 'a2ATask_anchoredAt_idx_893527a5',
        columns: ['anchoredAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'a2ATask',
        index: 'a2ATask_contextId_idx_b3ef67fd',
        columns: ['contextId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'a2ATask',
        index: 'a2ATask_tenant_ownerAgentId_idx_2c464bde',
        columns: ['tenant', 'ownerAgentId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

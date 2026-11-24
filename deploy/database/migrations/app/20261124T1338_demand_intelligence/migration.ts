#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0ec7ac3ae9ecdc6a01ec7f4b635ed70f577462a115e138fbb366991c811d095d/contract';
import startContract from '../../snapshots/0ec7ac3ae9ecdc6a01ec7f4b635ed70f577462a115e138fbb366991c811d095d/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c7f566ab20a8b3c767ae2e6447944c6d0ea632cd24c4079b36eba03b9a4a5b0d/contract';
import endContract from '../../snapshots/c7f566ab20a8b3c767ae2e6447944c6d0ea632cd24c4079b36eba03b9a4a5b0d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'demandCluster',
        columns: [
          col('capabilityKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('category', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('clusterKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('count', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('feature', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('firstSeenAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastSeenAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('level', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('levelBreakdown', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('OPEN'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('uniqueActors', 'int4', {
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
      this.createTable({
        schema: 'public',
        table: 'demandEvent',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('entityId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('entityType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('idempotencyKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('seq', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('visibility', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'demandOpportunity',
        columns: [
          col('backlogTaskId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('closedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('clusterId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdBy', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('declineReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('expectedValue', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('hypothesis', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('metricsSnapshot', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('PROPOSED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
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
        table: 'demandSignal',
        columns: [
          col('actorRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('actorResolution', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('capabilityKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('category', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('clusterId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('context', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('contextRetainUntil', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('declaredLevel', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('dedupeKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('dedupeScope', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('feature', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('idempotencyKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('level', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('normalizedText', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('relatedCount', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('relatedSignalId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'demandCluster',
        constraint: 'demandCluster_clusterKey_key',
        columns: ['clusterKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'demandEvent',
        constraint: 'demandEvent_idempotencyKey_key',
        columns: ['idempotencyKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'demandEvent',
        constraint: 'demandEvent_entityType_entityId_seq_key',
        columns: ['entityType', 'entityId', 'seq'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'demandSignal',
        constraint: 'demandSignal_idempotencyKey_dedupeScope_key',
        columns: ['idempotencyKey', 'dedupeScope'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demandCluster',
        index: 'demandCluster_level_idx_30977cf3',
        columns: ['level'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demandCluster',
        index: 'demandCluster_status_count_idx_32483a08',
        columns: ['status', 'count'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demandCluster',
        index: 'demandCluster_uniqueActors_idx_e1d3e7e5',
        columns: ['uniqueActors'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demandEvent',
        index: 'demandEvent_entityId_idx_18814ca5',
        columns: ['entityId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demandEvent',
        index: 'demandEvent_kind_idx_c9ca668f',
        columns: ['kind'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demandOpportunity',
        index: 'demandOpportunity_clusterId_idx_58f0e332',
        columns: ['clusterId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demandOpportunity',
        index: 'demandOpportunity_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demandSignal',
        index: 'demandSignal_actorResolution_actorRef_idx_c28d4a15',
        columns: ['actorResolution', 'actorRef'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demandSignal',
        index: 'demandSignal_category_feature_idx_5cdeb0b6',
        columns: ['category', 'feature'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demandSignal',
        index: 'demandSignal_clusterId_idx_58f0e332',
        columns: ['clusterId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demandSignal',
        index: 'demandSignal_dedupeKey_idx_99b3b4a9',
        columns: ['dedupeKey'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demandSignal',
        index: 'demandSignal_level_idx_30977cf3',
        columns: ['level'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demandSignal',
        index: 'demandSignal_relatedSignalId_idx_1f1a8fbf',
        columns: ['relatedSignalId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'demandSignal',
        index: 'demandSignal_source_createdAt_idx_ca471564',
        columns: ['source', 'createdAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

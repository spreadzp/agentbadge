#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1931ea48e1bdc8d0548abd5695e703742c78c0729bade76330bffcb317acd416/contract';
import endContract from '../../snapshots/1931ea48e1bdc8d0548abd5695e703742c78c0729bade76330bffcb317acd416/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/fb111c796948c0c2daa1c7b70adbbacec44f4d2c77598a081e1fe7900cf9884d/contract';
import startContract from '../../snapshots/fb111c796948c0c2daa1c7b70adbbacec44f4d2c77598a081e1fe7900cf9884d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'knowledgeCapability',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
        table: 'knowledgeEvidence',
        columns: [
          col('addedBy', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('label', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('uri', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('versionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'knowledgeGap',
        columns: [
          col('capabilityRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('count', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('firstSeenAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('intent', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('lastSeenAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('linkedItemId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('normalizedQuery', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sampleQueries', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'knowledgeItem',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdBy', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('latestVersionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('publishedVersionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('slug', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
        table: 'knowledgeItemCapability',
        columns: [
          col('capabilityId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('itemId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['itemId', 'capabilityId'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'knowledgeRelation',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdBy', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('fromItemId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('toItemId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'knowledgeStatusEvent',
        columns: [
          col('actor', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('from', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('itemId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('to', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'knowledgeVersion',
        columns: [
          col('body', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdBy', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('itemId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('restoredFromVersionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('seq', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('summary', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'knowledgeCapability',
        constraint: 'knowledgeCapability_name_key',
        columns: ['name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'knowledgeGap',
        constraint: 'knowledgeGap_normalizedQuery_key',
        columns: ['normalizedQuery'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'knowledgeItem',
        constraint: 'knowledgeItem_slug_key',
        columns: ['slug'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'knowledgeRelation',
        constraint: 'knowledgeRelation_fromItemId_toItemId_type_key',
        columns: ['fromItemId', 'toItemId', 'type'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'knowledgeVersion',
        constraint: 'knowledgeVersion_itemId_seq_key',
        columns: ['itemId', 'seq'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeCapability',
        index: 'knowledgeCapability_kind_idx_c9ca668f',
        columns: ['kind'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeCapability',
        index: 'knowledgeCapability_verified_idx_1612bd14',
        columns: ['verified'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeEvidence',
        index: 'knowledgeEvidence_uri_idx_334ba976',
        columns: ['uri'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeEvidence',
        index: 'knowledgeEvidence_versionId_idx_ef8aa804',
        columns: ['versionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeGap',
        index: 'knowledgeGap_count_idx_2c782125',
        columns: ['count'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeGap',
        index: 'knowledgeGap_status_lastSeenAt_idx_2807638d',
        columns: ['status', 'lastSeenAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeItem',
        index: 'knowledgeItem_kind_idx_c9ca668f',
        columns: ['kind'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeItem',
        index: 'knowledgeItem_status_updatedAt_idx_29f913bb',
        columns: ['status', 'updatedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeItemCapability',
        index: 'knowledgeItemCapability_capabilityId_idx_af7bb943',
        columns: ['capabilityId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeRelation',
        index: 'knowledgeRelation_toItemId_idx_2b82da8d',
        columns: ['toItemId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeRelation',
        index: 'knowledgeRelation_type_idx_b6b604ea',
        columns: ['type'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeStatusEvent',
        index: 'knowledgeStatusEvent_itemId_createdAt_idx_d577e708',
        columns: ['itemId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeVersion',
        index: 'knowledgeVersion_itemId_idx_41357140',
        columns: ['itemId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'knowledgeVersion',
        index: 'knowledge_version_fts_a1901957',
        expression: 'to_tsvector(\'simple\', "title" || \' \' || "body")',
        extras: { type: 'gin' },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

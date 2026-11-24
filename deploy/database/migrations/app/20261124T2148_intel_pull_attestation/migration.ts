#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/61bb8121238ceb76c3df38f88dcfc03781e7dc06e6f36383ab0447c300174e7e/contract';
import endContract from '../../snapshots/61bb8121238ceb76c3df38f88dcfc03781e7dc06e6f36383ab0447c300174e7e/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/bae95e243ae4b1ecdad8fbd49caaee81098aed812932f0d3e0d776b10a0f5f1b/contract';
import startContract from '../../snapshots/bae95e243ae4b1ecdad8fbd49caaee81098aed812932f0d3e0d776b10a0f5f1b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'intelAttestation',
        columns: [
          col('contentHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('issued', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('reportId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('revokedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('revokedReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('ruleset', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('scanId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('scores', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('signature', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('siteId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('validUntil', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'intelPullJob',
        columns: [
          col('claimedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('completedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('correlationId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('exp', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('keyId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('leaseExpiresAt', 'timestamptz', {
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('leaseGeneration', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('leaseToken', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('nonce', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('params', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('probeId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reclaimCount', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('result', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('resultEnvelopeId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('scanId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sig', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('siteId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'intelSecurityEvent',
        columns: [
          col('correlationId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('eventType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('jobId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('leaseGeneration', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('payloadDigest', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('principal', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('siteId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelAttestation',
        index: 'intelAttestation_scanId_idx_7c201901',
        columns: ['scanId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelAttestation',
        index: 'intelAttestation_siteId_issued_idx_19d5f124',
        columns: ['siteId', 'issued'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelAttestation',
        index: 'intelAttestation_tenantId_idx_c93ed4f1',
        columns: ['tenantId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelPullJob',
        index: 'intelPullJob_siteId_status_idx_51cae635',
        columns: ['siteId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelPullJob',
        index: 'intelPullJob_tenantId_idx_c93ed4f1',
        columns: ['tenantId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelSecurityEvent',
        index: 'intelSecurityEvent_siteId_createdAt_idx_2fcd3bd2',
        columns: ['siteId', 'createdAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

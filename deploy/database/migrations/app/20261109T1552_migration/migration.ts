#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/00e6f20c31337bbadfdfb5b2620d7c6e3c23d12305ef021a3bb52a91dfb8f721/contract';
import endContract from '../../snapshots/00e6f20c31337bbadfdfb5b2620d7c6e3c23d12305ef021a3bb52a91dfb8f721/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/1a14b094b57f1bba69a6facb398084be0f103c4fbb3cb05a11f5d5138347d3e6/contract';
import startContract from '../../snapshots/1a14b094b57f1bba69a6facb398084be0f103c4fbb3cb05a11f5d5138347d3e6/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'payment',
        columns: [
          col('agentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('amount', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('createdAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('currency', 'text', {
            notNull: true,
            default: lit('USD'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('customerId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('expiresAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('idempotencyKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('orderId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('productId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('purpose', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reference', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('updatedAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'paymentAttempt',
        columns: [
          col('amount', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('confirmedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('currency', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('expiresAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('network', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('paymentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('provider', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('providerReference', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('token', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('transactionHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'paymentEvent',
        columns: [
          col('actor', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('atMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('attemptId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('entity', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('from', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('paymentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('to', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'paymentPrice',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('amount', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('billingType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
          col('interval', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('productId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'paymentProduct',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('category', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'paymentReceipt',
        columns: [
          col('amount', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('asset', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('attemptId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('externalReference', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('network', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payer', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('paymentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('provider', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('recipient', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('transactionHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('verifiedAtMs', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'rescueTelemetryEvent',
        columns: [
          col('amountUsdc', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('asset', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('cliVersion', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('executionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ref', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('routeFrom', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('routeTo', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('txHashes', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('uaHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'payment',
        constraint: 'payment_reference_key',
        columns: ['reference'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'payment',
        constraint: 'payment_idempotencyKey_key',
        columns: ['idempotencyKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'paymentAttempt',
        constraint: 'paymentAttempt_provider_providerReference_key',
        columns: ['provider', 'providerReference'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'paymentAttempt',
        constraint: 'paymentAttempt_provider_transactionHash_key',
        columns: ['provider', 'transactionHash'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'paymentProduct',
        constraint: 'paymentProduct_code_key',
        columns: ['code'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'paymentReceipt',
        constraint: 'paymentReceipt_provider_externalReference_key',
        columns: ['provider', 'externalReference'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'payment',
        index: 'payment_agentId_idx_8d0ba4f0',
        columns: ['agentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'payment',
        index: 'payment_customerId_idx_b2a8a46c',
        columns: ['customerId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'payment',
        index: 'payment_expiresAtMs_idx_89d46aa4',
        columns: ['expiresAtMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'payment',
        index: 'payment_orderId_idx_d284871b',
        columns: ['orderId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'payment',
        index: 'payment_productId_idx_5858600a',
        columns: ['productId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'payment',
        index: 'payment_status_createdAtMs_idx_95013a06',
        columns: ['status', 'createdAtMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'paymentAttempt',
        index: 'paymentAttempt_paymentId_idx_b2fe9a10',
        columns: ['paymentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'paymentAttempt',
        index: 'paymentAttempt_status_expiresAtMs_idx_a69286ac',
        columns: ['status', 'expiresAtMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'paymentAttempt',
        index: 'paymentAttempt_transactionHash_idx_42bd5811',
        columns: ['transactionHash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'paymentEvent',
        index: 'paymentEvent_attemptId_atMs_idx_ea3be0a0',
        columns: ['attemptId', 'atMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'paymentEvent',
        index: 'paymentEvent_entity_atMs_idx_45e980a0',
        columns: ['entity', 'atMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'paymentEvent',
        index: 'paymentEvent_paymentId_atMs_idx_d0ad8de1',
        columns: ['paymentId', 'atMs'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'paymentPrice',
        index: 'paymentPrice_productId_active_idx_d401b859',
        columns: ['productId', 'active'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'paymentProduct',
        index: 'paymentProduct_active_idx_8af4daed',
        columns: ['active'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'paymentProduct',
        index: 'paymentProduct_category_active_idx_642db9a2',
        columns: ['category', 'active'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'paymentReceipt',
        index: 'paymentReceipt_attemptId_idx_94f50eb9',
        columns: ['attemptId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'paymentReceipt',
        index: 'paymentReceipt_paymentId_idx_b2fe9a10',
        columns: ['paymentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'paymentReceipt',
        index: 'paymentReceipt_transactionHash_idx_42bd5811',
        columns: ['transactionHash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'rescueTelemetryEvent',
        index: 'rescueTelemetryEvent_routeTo_createdAt_idx_32ee72c2',
        columns: ['routeTo', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'rescueTelemetryEvent',
        index: 'rescueTelemetryEvent_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

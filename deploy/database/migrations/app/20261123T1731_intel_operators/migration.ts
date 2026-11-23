#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/24f19907e9fe698ec1c977b1164ccdd02afc61f44461bb1bc0e38664da6acfc1/contract';
import startContract from '../../snapshots/24f19907e9fe698ec1c977b1164ccdd02afc61f44461bb1bc0e38664da6acfc1/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/2e1c3c464ec1924cd8bc655e4fcea3449b9817e707bc6eaa5bb9a83796d61980/contract';
import endContract from '../../snapshots/2e1c3c464ec1924cd8bc655e4fcea3449b9817e707bc6eaa5bb9a83796d61980/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'intelOperator',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('keyHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('keyPrefix', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('revokedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('role', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('active'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelOperator',
        constraint: 'intelOperator_keyHash_key',
        columns: ['keyHash'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'intelOperator',
        constraint: 'intelOperator_tenantId_email_key',
        columns: ['tenantId', 'email'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'intelOperator',
        index: 'intelOperator_tenantId_status_idx_d3d04256',
        columns: ['tenantId', 'status'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

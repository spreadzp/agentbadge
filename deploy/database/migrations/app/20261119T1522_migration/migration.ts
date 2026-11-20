#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0a3ebb89baf34c26e2199b84f1b23ea0416e64efec0cd3f67a1405678aeda779/contract';
import startContract from '../../snapshots/0a3ebb89baf34c26e2199b84f1b23ea0416e64efec0cd3f67a1405678aeda779/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c9f2020ddef080ce0f72aac86fcec6f3731b2218a222c863d70eba658341621b/contract';
import endContract from '../../snapshots/c9f2020ddef080ce0f72aac86fcec6f3731b2218a222c863d70eba658341621b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropConstraint({
        schema: 'public',
        table: 'commerceAgreement',
        constraint: 'commerceAgreement_taskId_key',
      }),
      this.addColumn({
        schema: 'public',
        table: 'commerceSubmission',
        column: col('milestoneRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'commerceTask',
        column: col('maxProviders', 'int4', {
          notNull: true,
          default: lit(1),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceAgreement',
        index: 'commerceAgreement_taskId_idx_4965c936',
        columns: ['taskId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'commerceSubmission',
        index: 'commerceSubmission_milestoneRef_idx_47b89f34',
        columns: ['milestoneRef'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/9b0a6a551178ff5e38798a34f47ad09fe1fe10047d838252bfb40a113c4f8a31/contract';
import endContract from '../../snapshots/9b0a6a551178ff5e38798a34f47ad09fe1fe10047d838252bfb40a113c4f8a31/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c9f2020ddef080ce0f72aac86fcec6f3731b2218a222c863d70eba658341621b/contract';
import startContract from '../../snapshots/c9f2020ddef080ce0f72aac86fcec6f3731b2218a222c863d70eba658341621b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'spendApproval',
        column: col('dealFingerprint', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'spendApproval',
        index: 'spendApproval_wallet_dealFingerprint_idx_996dbbbb',
        columns: ['wallet', 'dealFingerprint'],
        extras: { where: "(state = 'pending')", unique: true },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

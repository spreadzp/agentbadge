#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/174bbe13adcd8dd1ef05efb4b4ab5e7a9b30646347d508ceedf1f228d4298d7b/contract';
import startContract from '../../snapshots/174bbe13adcd8dd1ef05efb4b4ab5e7a9b30646347d508ceedf1f228d4298d7b/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/44914cdb9d22e153491d56bf480c7bdb5fdbc38b06ef48083e57ad30d332e07f/contract';
import endContract from '../../snapshots/44914cdb9d22e153491d56bf480c7bdb5fdbc38b06ef48083e57ad30d332e07f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'agentQAPair',
        column: col('retractReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentQAPair',
        column: col('retractedAtMs', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentRequest',
        column: col('publishToQa', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

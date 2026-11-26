#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1a0ea94a2443f0233b05312efc43fb4de0d183cfa337c395a9bec0a6ca576067/contract';
import endContract from '../../snapshots/1a0ea94a2443f0233b05312efc43fb4de0d183cfa337c395a9bec0a6ca576067/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/5e6a3a552a574fa5dee78118c5afa2d9e522da4b96877cda3796d0e4ec272b9d/contract';
import startContract from '../../snapshots/5e6a3a552a574fa5dee78118c5afa2d9e522da4b96877cda3796d0e4ec272b9d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'reviewDecision',
        column: col('aiRunRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

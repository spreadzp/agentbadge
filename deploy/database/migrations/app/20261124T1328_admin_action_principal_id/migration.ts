#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0ec7ac3ae9ecdc6a01ec7f4b635ed70f577462a115e138fbb366991c811d095d/contract';
import endContract from '../../snapshots/0ec7ac3ae9ecdc6a01ec7f4b635ed70f577462a115e138fbb366991c811d095d/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/bd5320ac2cc47ee11b63a2933307aa4f940b5e3a06e91f678ef66de79d8d7b8e/contract';
import startContract from '../../snapshots/bd5320ac2cc47ee11b63a2933307aa4f940b5e3a06e91f678ef66de79d8d7b8e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'adminAction',
        column: col('principalId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

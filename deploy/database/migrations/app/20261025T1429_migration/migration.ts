#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1a14b094b57f1bba69a6facb398084be0f103c4fbb3cb05a11f5d5138347d3e6/contract';
import endContract from '../../snapshots/1a14b094b57f1bba69a6facb398084be0f103c4fbb3cb05a11f5d5138347d3e6/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c47f4a413206d1a775d53b05c45f64240b961ea6e0ecca2f2a6d39e78f194f0c/contract';
import startContract from '../../snapshots/c47f4a413206d1a775d53b05c45f64240b961ea6e0ecca2f2a6d39e78f194f0c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'agentTrustEdge',
        column: col('firstEventAt', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentTrustEdge',
        column: col('firstEventSeq', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

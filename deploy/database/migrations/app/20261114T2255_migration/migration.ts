#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/54c2a5b26f1b3d894327cc5f3d46ddf6c1586d5fde50c92a2bd6b1ff0ceda73b/contract';
import endContract from '../../snapshots/54c2a5b26f1b3d894327cc5f3d46ddf6c1586d5fde50c92a2bd6b1ff0ceda73b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e0d9ff4a57e0b7753ed22534b8a062014b4150a40fabd7a5383c503c6a8b0b8d/contract';
import startContract from '../../snapshots/e0d9ff4a57e0b7753ed22534b8a062014b4150a40fabd7a5383c503c6a8b0b8d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'surveyAnswer',
        column: col('flag', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'surveyAnswer',
        column: col('softFpHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'surveyAnswer',
        index: 'surveyAnswer_surveyId_softFpHash_idx_0ed584c4',
        columns: ['surveyId', 'softFpHash'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

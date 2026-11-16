#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0c1bc30f48fbd4d9e6e1fa4cd5f16a99f2a9ea4811eb1ec19947290e2112a455/contract';
import endContract from '../../snapshots/0c1bc30f48fbd4d9e6e1fa4cd5f16a99f2a9ea4811eb1ec19947290e2112a455/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/54c2a5b26f1b3d894327cc5f3d46ddf6c1586d5fde50c92a2bd6b1ff0ceda73b/contract';
import startContract from '../../snapshots/54c2a5b26f1b3d894327cc5f3d46ddf6c1586d5fde50c92a2bd6b1ff0ceda73b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addUnique({
        schema: 'public',
        table: 'commerceEvent',
        constraint: 'commerceEvent_entityType_entityId_prevHash_key',
        columns: ['entityType', 'entityId', 'prevHash'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/44914cdb9d22e153491d56bf480c7bdb5fdbc38b06ef48083e57ad30d332e07f/contract';
import startContract from '../../snapshots/44914cdb9d22e153491d56bf480c7bdb5fdbc38b06ef48083e57ad30d332e07f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/5cc05c7580b7916ed4b358c580b28b24d76b9c2825fbe72c359888fb6df0a582/contract';
import endContract from '../../snapshots/5cc05c7580b7916ed4b358c580b28b24d76b9c2825fbe72c359888fb6df0a582/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropIndex({
        schema: 'public',
        table: 'refundIntent',
        index: 'refundIntent_txHash_idx_3fbe8b55',
      }),
      this.addUnique({
        schema: 'public',
        table: 'refundIntent',
        constraint: 'refundIntent_txHash_key',
        columns: ['txHash'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

/**
 * SLICE-215-6: dump a REAL ShipmentReplayResponse for the Brick #4
 * article — a mid-flight chain (hop 0 verified, hop 1 paid, hop 2
 * offered). Output is copied verbatim into the article (D-215-6:
 * never invent a response).
 */
import { makeChain } from "../tests/supply-chain/helpers/chain-fixture";
import {
  acceptShipment,
  handoffHop,
  settleHop,
  verifyHop,
} from "../src/server/lib/econ-ledger/supply-chain/shipment";
import { shipmentReplay } from "../src/server/lib/econ-ledger/supply-chain/replay";

const CLIENT = ("0x" + "aa".repeat(20)) as `0x${string}`;
const ROTTERDAM = ("0x" + "11".repeat(20)) as `0x${string}`;
const TRUCKER = ("0x" + "22".repeat(20)) as `0x${string}`;
const WAREHOUSE = ("0x" + "33".repeat(20)) as `0x${string}`;
const TEMP_LOGGER = ("0x" + "44".repeat(20)) as `0x${string}`;
const DISPATCH_BOT = ("0x" + "55".repeat(20)) as `0x${string}`;

const hash = (n: number) => `0x${String(n).padStart(64, "0")}` as `0x${string}`;
const SID = "shp-demo-vitrine";

const roles0 = {
  custodian: { address: ROTTERDAM, type: "org", label: "Maasvlakte ColdPort B.V." },
  device: { address: TEMP_LOGGER, type: "device", label: "Sensitech Tag-9 reefer logger" },
};
const ev0 = [
  { type: "temperature", hash: hash(1), issuer: { address: TEMP_LOGGER, type: "device" }, uri: "ipfs://bafybeih7f2i3d9q3k5m4n6o7p8q9r0s1t2u3v4w5x6y" },
  { type: "document", hash: hash(2), issuer: { address: ROTTERDAM, type: "org" }, uri: "https://docs.coldport.example/bol/BX-2041" },
];
const roles1 = {
  custodian: { address: TRUCKER, type: "org", label: "Venlo Freight Logistics" },
  operator: { address: DISPATCH_BOT, type: "agent", label: "fleet-dispatch-bot" },
};
const ev1 = [
  { type: "gps", hash: hash(3), issuer: { address: TRUCKER, type: "org" }, uri: "https://telematics.venlofreight.example/track/TR-7781" },
  { type: "signature", hash: hash(4), issuer: { address: DISPATCH_BOT, type: "agent" } },
];
const roles2 = {
  custodian: { address: WAREHOUSE, type: "org", label: "Venlo Pharma Hub" },
};

const chain = await makeChain({
  shipmentId: SID,
  client: CLIENT,
  lifecycle: "offered",
  hops: [
    { receiver: ROTTERDAM, amountUsdc: "120.5" },
    { receiver: TRUCKER, amountUsdc: "85" },
    { receiver: WAREHOUSE, amountUsdc: "40.25" },
  ],
});

const { deps } = chain;

// Hop 0: accept → handoff (roles+evidence) → settle → verify pass.
await acceptShipment(SID, 0, SID, ROTTERDAM, deps);
await handoffHop(
  SID, 0, { deliverableHash: hash(10) }, CLIENT, ROTTERDAM, deps,
  {
    what: "40ft reefer container — insulin, batch BX-2041",
    where: "Port of Rotterdam, Maasvlakte II",
    why: "export release to EU distributor",
  },
  roles0, ev0,
);
await settleHop(SID, 0, "120.5", CLIENT, ROTTERDAM, deps);
await verifyHop(SID, 0, "pass", TRUCKER, ROTTERDAM, deps);

// Hop 1: accept → handoff (roles+evidence) → settle (paid, unverified).
await acceptShipment(SID, 1, SID, TRUCKER, deps);
await handoffHop(
  SID, 1, { proofOfDelivery: "pod-TR-7781.pdf" }, ROTTERDAM, TRUCKER, deps,
  {
    what: "reefer trailer leg — Rotterdam → Venlo",
    where: "A15 motorway, NL corridor",
    why: "inland transfer, cold chain maintained",
  },
  roles1, ev1,
);
await settleHop(SID, 1, "85", CLIENT, TRUCKER, deps);

// Hop 2 stays offered — mid-flight state for the vitrine.

const replay = await shipmentReplay(deps.ledger, SID);
if (replay === null) {
  console.error("replay null — fixture produced a non-replayable chain");
  process.exit(1);
}
console.log(JSON.stringify(replay, null, 2));
console.log(JSON.stringify(replay, null, 2));

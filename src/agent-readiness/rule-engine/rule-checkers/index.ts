// EPIC-140 (SLICE-140-18): barrel — preserves './rule-checkers' public API.
export * from "./helpers";
export * from "./discovery";
export * from "./content";
export * from "./functional";

import type { SourceState } from "../../scanner/source-state";
import type { Evidence } from "../evidence.types";
import { checkAb001, checkAb002, checkAb003, checkAb004, checkAb005, checkAb006, checkAb007, checkAb008, checkAb009, checkAb010, checkAb011, checkAb012, checkAb013, checkAb014 } from "./discovery";
import { checkAb104, checkAb105, checkAb106, checkAb107, checkAb108, checkAb109, checkAb110, checkAb111, checkAb112, checkAb113, checkAb114, checkAb115, checkAb116, checkAb117, checkAb118, checkAb098, checkAb099, checkAb100, checkAb101, checkAb102, checkAb103 } from "./content";
import { checkAb119, checkAb120, checkAb121, checkAb122, checkAb123, checkAb124, checkAb125, checkAb126, checkAb127 } from "./functional";

// Registry: rule_id → checker function
export const RULE_CHECKERS: Record<string, (state: SourceState) => Evidence[]> = {
  "AB-001": checkAb001,
  "AB-002": checkAb002,
  "AB-003": checkAb003,
  "AB-004": checkAb004,
  "AB-005": checkAb005,
  "AB-006": checkAb006,
  "AB-007": checkAb007,
  "AB-008": checkAb008,
  "AB-009": checkAb009,
  "AB-010": checkAb010,
  "AB-011": checkAb011,
  "AB-012": checkAb012,
  "AB-013": checkAb013,
  "AB-014": checkAb014,
  "AB-104": checkAb104,
  "AB-105": checkAb105,
  "AB-106": checkAb106,
  "AB-107": checkAb107,
  "AB-108": checkAb108,
  "AB-109": checkAb109,
  "AB-110": checkAb110,
  "AB-111": checkAb111,
  "AB-112": checkAb112,
  "AB-113": checkAb113,
  "AB-114": checkAb114,
  "AB-115": checkAb115,
  "AB-116": checkAb116,
  "AB-117": checkAb117,
  "AB-118": checkAb118,
  "AB-098": checkAb098,
  "AB-099": checkAb099,
  "AB-100": checkAb100,
  "AB-101": checkAb101,
  "AB-102": checkAb102,
  "AB-103": checkAb103,
  "AB-119": checkAb119,
  "AB-120": checkAb120,
  "AB-121": checkAb121,
  "AB-122": checkAb122,
  "AB-123": checkAb123,
  "AB-124": checkAb124,
  "AB-125": checkAb125,
  "AB-126": checkAb126,
  "AB-127": checkAb127,
};

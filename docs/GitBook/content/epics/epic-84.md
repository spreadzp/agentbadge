# EPIC-84: Marketplace State Machine

## Goal

Formalize the marketplace task lifecycle as a state machine with explicit transitions, validation, and error handling.

## States

`posted` → `claimed` → `delivered` → `completed`

Additional states: `cancelled`, `expired`, `disputed`

## Key Deliverables

- Formal state machine implementation
- Transition validation (no invalid state jumps)
- HCS message per state transition
- Timeout handling for stale claims
- Escrow integration with state machine

## Source

- [EPIC-84 full document](https://github.com/spreadzp/agentbadge/tree/main/docs/EPICS/)

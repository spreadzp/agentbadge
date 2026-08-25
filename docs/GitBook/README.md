# GitBook Knowledge Base — Setup & Workflow Guide

This directory contains everything needed to publish project documentation to GitBook as a collaborative knowledge base.

## What's Here

| File | Purpose |
|---|---|
| `README.md` | This file — overview and quick start |
| `SETUP-GUIDE.md` | Step-by-step GitBook setup (Git Sync, spaces, structure) |
| `COLLABORATION-WORKFLOW.md` | How multiple team members edit, review, and publish |
| `CONTENT-STRUCTURE.md` | Recommended page hierarchy and organization |
| `GITBOOK-FEATURES.md` | GitBook-specific features (hints, tabs, includes, variables, API blocks) |
| `.gitbook.yaml` | GitBook configuration file (root, structure, redirects) |
| `SUMMARY.md` | Table of contents / navigation tree |
| `content/` | Actual documentation pages synced to GitBook |

## Quick Start

1. **Read** `SETUP-GUIDE.md` — follow steps to connect this repo to GitBook via Git Sync
2. **Read** `COLLABORATION-WORKFLOW.md` — understand the editing workflow for distributed teams
3. **Read** `CONTENT-STRUCTURE.md` — see how documentation should be organized
4. **Edit** `SUMMARY.md` — add your pages to the navigation tree
5. **Write** markdown files in `content/` — they auto-sync to GitBook

## Key Principle

GitBook uses **Git Sync** — your markdown files in this repo ARE the documentation. No separate editor needed. Changes pushed to GitHub/GitLab appear in GitBook automatically, and edits made in GitBook's web editor are committed back to the repo.

This means:
- Developers can edit docs in their IDE and push via git
- Non-technical team members can use GitBook's web editor
- Both workflows sync bi-directionally
- All changes are version-controlled

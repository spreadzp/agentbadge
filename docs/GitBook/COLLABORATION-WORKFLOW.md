# Collaboration Workflow for Distributed Teams

## Overview

GitBook + Git Sync enables two complementary workflows that sync bi-directionally:

```
┌─────────────────┐     Git Sync      ┌──────────────────┐
│   GitHub Repo    │ ◄══════════════► │  GitBook Space   │
│  (markdown files)│                   │  (web editor)    │
└─────────────────┘                    └──────────────────┘
        ▲                                       ▲
        │                                       │
   Developers                              Non-technical
   (IDE + git)                             team members
                                           (web editor)
```

## Workflow A: Developer (IDE + Git)

For technical team members who prefer editing in their IDE:

1. **Pull latest:** `git pull origin main`
2. **Create a branch:** `git checkout -b docs/add-scanner-guide`
3. **Edit markdown files** in `docs/GitBook/content/`
4. **Update `SUMMARY.md`** if adding new pages
5. **Commit:** `git commit -m "docs: add scanner guide page"`
6. **Push:** `git push origin docs/add-scanner-guide`
7. **Create PR** on GitHub
8. **Review** — team reviews the PR
9. **Merge** — GitBook auto-syncs the published content

### Conventions

- **Branch naming:** `docs/<topic>` (e.g., `docs/api-reference`, `docs/fix-typos`)
- **Commit messages:** `docs: <description>` (conventional commits)
- **One PR per topic** — keep changes focused
- **Always update SUMMARY.md** when adding/removing pages

## Workflow B: Non-Technical (GitBook Web Editor)

For team members who prefer the web interface:

1. **Go to** the GitBook space URL
2. **Click "Edit"** on any page (or create a new page)
3. **Make changes** using the rich text / markdown editor
4. **Create a Change Request** (equivalent to a PR)
5. **Add reviewers** — select team members
6. **Reviewers approve** — changes merge automatically
7. **GitHub auto-updates** — a commit appears in the repo

### Change Requests = Pull Requests

| GitBook | GitHub |
|---|---|
| Change Request | Pull Request |
| Merge Change Request | Merge PR |
| Reviewer | PR Reviewer |
| Suggestion | PR Comment |

## Workflow C: Mixed (Review in GitHub, Edit in GitBook)

The most common workflow for this team:

1. **Author** writes content in GitBook web editor
2. **Creates Change Request** in GitBook
3. **GitHub PR** is automatically created
4. **Developer reviewer** reviews the PR in GitHub (can see the markdown diff)
5. **Approves** in GitHub or GitBook
6. **Merge** — content goes live

## Conflict Resolution

Since Git Sync is bi-directional, conflicts can occur:

### Prevention
- **Don't edit the same page** simultaneously in GitBook and GitHub
- **Use branches/change requests** — not direct edits to main
- **Communicate** — coordinate who's editing what

### Resolution
1. GitBook detects a conflict and pauses sync
2. Resolve in GitHub (standard git merge conflict resolution)
3. Push the resolved version
4. GitBook resumes sync automatically

## Page Ownership

To avoid conflicts, assign page owners:

| Section | Owner | GitBook Role |
|---|---|---|
| Architecture | Tech Lead | Editor |
| API Reference | Backend Dev | Editor |
| Guides | Tech Writer | Editor |
| Marketing | Marketing Lead | Editor |
| EPICs | PM | Editor |

## Best Practices

- **Small, focused changes** — one page per change request when possible
- **Use GitBook hints** for callouts instead of ad-hoc formatting
- **Link between pages** using relative links (`[link](../other-page.md)`)
- **Use includes** for repeated content (e.g., prerequisites, contact info)
- **Preview before publishing** — GitBook shows a preview before merging
- **Tag change requests** — use labels like "needs-review", "wip", "ready-to-merge"

# GitBook Setup Guide

## Prerequisites

- A GitHub repository (this one: `agents-ai/hedera`)
- A GitBook account (free tier supports 1 space; Pro/Enterprise for multiple spaces)
- Admin access to both GitHub repo and GitBook organization

## Step 1: Create a GitBook Organization & Space

1. Go to [app.gitbook.com](https://app.gitbook.com) and sign up / sign in
2. Create an **Organization** (e.g., "AgentBadge")
3. Create a **Space** (e.g., "AgentBadge Knowledge Base")
   - A space = one documentation site
   - You can create multiple spaces for different projects

## Step 2: Enable Git Sync (GitHub)

1. In your GitBook space, go to **Settings → Git Sync**
2. Select **GitHub** as the provider
3. Authorize the GitBook GitHub App:
   - Install the GitBook app on your GitHub account/org
   - Select the repository: `agents-ai/hedera`
4. Configure sync settings:
   - **Branch:** `main` (or a dedicated `docs` branch)
   - **Root directory:** `docs/GitBook/content/`
   - This tells GitBook to only sync files under `docs/GitBook/content/`
5. Click **Enable Sync**

### Alternative: Dedicated docs branch

If you prefer not to mix docs with code:

```bash
git checkout -b docs
git push origin docs
```

Then select `docs` branch in GitBook Git Sync settings.

## Step 3: Configure .gitbook.yaml

The `.gitbook.yaml` file (already created in this directory) tells GitBook how to structure the documentation:

```yaml
root: ./content/
structure:
  readme: README.md
  summary: SUMMARY.md
```

- `root` — where documentation files live (relative to this directory)
- `structure.readme` — the homepage
- `structure.summary` — the navigation table of contents

## Step 4: Verify Sync

After enabling Git Sync:

1. Make a small edit to any `.md` file in `content/`
2. Push to GitHub
3. Check GitBook — the change should appear within seconds
4. Conversely, edit a page in GitBook's web editor
5. Check GitHub — a commit should appear in the repo

## Step 5: Invite Team Members

1. In GitBook, go to **Settings → Members**
2. Add team members by email
3. Assign roles:
   - **Admin** — full access, can change settings
   - **Editor** — can edit content, create change requests
   - **Reviewer** — can review and approve change requests
   - **Viewer** — read-only access

## Step 6: Set Up Change Requests (Recommended)

GitBook uses **Change Requests** (similar to pull requests) for content review:

1. Go to **Settings → Change Requests → Enable**
2. Configure:
   - Require approval before publishing
   - Auto-merge after approval (optional)
3. Team members create change requests in GitBook
4. These appear as commits/PRs in GitHub
5. Reviewers approve in GitBook or GitHub

## Step 7: Custom Domain (Optional)

1. Go to **Settings → Domain**
2. Add custom domain (e.g., `docs.agentbadge.xyz`)
3. Configure DNS CNAME record as instructed
4. SSL is automatic via GitBook

## Programmatic Access (Level 1)

### Reading via MCP

GitBook provides a built-in MCP server on every published site. Enable it:

1. Go to **Settings → Customization → Page actions**
2. Enable **Connect with MCP server**
3. MCP endpoint: `https://docs.agentbadge.xyz/~gitbook/mcp`

Add to MCP client config (Windsurf, Claude, Cursor, VS Code):

```json
{
  "mcpServers": {
    "gitbook-docs": {
      "url": "https://docs.agentbadge.xyz/~gitbook/mcp"
    }
  }
}
```

This gives read-only access: search pages, get content, list structure.

### Writing via GitBook API (curl)

Get a developer token at [app.gitbook.com/account/developer-token](https://app.gitbook.com/account/developer-token).

```bash
export GITBOOK_TOKEN="your-developer-token"
export GITBOOK_SPACE_ID="your-space-id"

# List all pages
curl -s -H "Authorization: Bearer $GITBOOK_TOKEN" \
  https://api.gitbook.com/v1/spaces/$GITBOOK_SPACE_ID/content

# Get a specific page
curl -s -H "Authorization: Bearer $GITBOOK_TOKEN" \
  https://api.gitbook.com/v1/spaces/$GITBOOK_SPACE_ID/content/page/$PAGE_ID

# Update a page (markdown)
curl -X PUT \
  -H "Authorization: Bearer $GITBOOK_TOKEN" \
  -H "Content-Type: application/json" \
  https://api.gitbook.com/v1/spaces/$GITBOOK_SPACE_ID/content/page/$PAGE_ID \
  -d '{"document": {"markdown": "# Updated content\n\nNew text here."}}'

# Create a new page
curl -X POST \
  -H "Authorization: Bearer $GITBOOK_TOKEN" \
  -H "Content-Type: application/json" \
  https://api.gitbook.com/v1/spaces/$GITBOOK_SPACE_ID/content \
  -d '{"title": "New Page", "document": {"markdown": "# Hello World"}}'

# Search across the space
curl -s -H "Authorization: Bearer $GITBOOK_TOKEN" \
  "https://api.gitbook.com/v1/spaces/$GITBOOK_SPACE_ID/search?query=passport"
```

Store credentials in `.env`:

```bash
GITBOOK_API_TOKEN=your-developer-token
GITBOOK_SPACE_ID=your-space-id
GITBOOK_ORG_ID=your-org-id
```

### Writing via Git Push (primary workflow)

The primary way to update docs is just git push — Git Sync handles the rest:

```bash
# Edit markdown in docs/GitBook/content/
git add docs/GitBook/content/
git commit -m "docs: update installation guide"
git push origin main
# GitBook auto-syncs within seconds
```

## Troubleshooting

| Problem | Solution |
|---|---|
| Sync not working | Check GitHub App permissions in repo settings → Settings → Integrations |
| Pages not appearing | Verify `SUMMARY.md` lists all pages; unlisted pages won't appear in navigation |
| Images not loading | Place images in `content/.gitbook/assets/` and reference with relative paths |
| Merge conflicts | GitBook locks live edits when Git Sync is active; resolve conflicts in GitHub |

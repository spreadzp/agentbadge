# GitBook Features for Rich Documentation

GitBook supports several custom markdown blocks beyond standard markdown. Use these to create professional, interactive documentation.

## Hints (Callouts)

Highlight important information without disrupting reading flow.

```markdown
{% hint style="info" %}
This is an informational hint with helpful context.
{% endhint %}

{% hint style="warning" %}
Be careful when running this command in production.
{% endhint %}

{% hint style="danger" %}
This action cannot be undone. Make sure you have backups.
{% endhint %}

{% hint style="success" %}
Your configuration has been saved successfully!
{% endhint %}
```

## Tabs (Alternative Content)

Present alternative content, like code in different languages:

```markdown
{% tabs %}
{% tab title="TypeScript" %}
```typescript
const greeting: string = 'Hello World';
console.log(greeting);
```
{% endtab %}

{% tab title="Python" %}
```python
greeting = "Hello World"
print(greeting)
```
{% endtab %}
{% endtabs %}
```

## Includes (Reusable Content)

Include content from other files — ideal for boilerplate that appears in multiple places:

```markdown
{% include "../.gitbook/includes/prerequisites.md" %}
```

Create reusable blocks in `content/.gitbook/includes/`:

- `prerequisites.md` — common prerequisites
- `contact-info.md` — team contact information
- `disclaimer.md` — legal disclaimers

## Variables

Define space-level variables in `content/.gitbook/vars.yaml`:

```yaml
project_name: AgentBadge
support_email: support@agentbadge.xyz
docs_url: https://docs.agentbadge.xyz
api_base_url: https://agentbadge.xyz/api
```

Reference them in any page:

```markdown
Contact us at <code class="expression">space.vars.support_email</code>
```

## Columns (Side-by-Side Layout)

```markdown
{% columns %}
{% column %}
### Free Tier

- 1,000 requests/hour
- 10,000 requests/day
{% endcolumn %}

{% column %}
### Pro Tier

- 10,000 requests/hour
- 100,000 requests/day
{% endcolumn %}
{% endcolumns %}
```

## Expandable Details

```markdown
<details>
<summary>Need higher limits?</summary>

Contact our sales team to discuss enterprise plans.
</details>
```

## Buttons

```markdown
<a href="https://example.com/signup" class="button primary" data-icon="rocket">Get Started</a>
```

## API Blocks

GitBook can render OpenAPI specs interactively. Publish via CLI:

```bash
npx -y @gitbook/cli@latest openapi publish \
  --spec "agentbadge-api" \
  --organization "$GITBOOK_ORGANIZATION_ID" \
  path/to/openapi.json
```

Or embed inline using the API block in the web editor.

## Steppers (Step-by-Step)

```markdown
{% stepper %}
{% step %}
## Step 1

Description of step 1.
{% endstep %}

{% step %}
## Step 2

Description of step 2.
{% endstep %}
{% endstepper %}
```

## Emojis & Icons

GitBook supports emojis in markdown. Use them sparingly for visual cues:

- ✅ for completed/done
- ❌ for not done/blocked
- ⚠️ for warnings
- 🚀 for launches/new features

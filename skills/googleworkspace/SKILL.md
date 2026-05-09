---
name: googleworkspace
description: Manage Google Drive, Gmail, Calendar, Sheets, Docs, and Chat via the gws CLI
metadata:
  shelllm:
    requires:
      bins: ["gws"]
---

# googleworkspace — Google Workspace via the gws CLI

## Overview

The `gws` CLI provides access to Google Workspace APIs (Drive, Gmail, Calendar, Sheets, Docs, Chat, and more). Commands are dynamically generated from Google's Discovery Service.

```
gws <service> <resource> <method> [flags]
```

Helper commands (prefixed with `+`) provide shortcuts for common workflows.

## Authentication

```bash
# Browser-based OAuth (interactive, one-time)
gws auth login

# Or use an existing access token
export GOOGLE_WORKSPACE_CLI_TOKEN=$(gcloud auth print-access-token)
```

## Global flags

| Flag | Description |
|------|-------------|
| `--params '{...}'` | URL/query parameters (JSON) |
| `--json '{...}'` | Request body (JSON) |
| `--dry-run` | Preview request without calling the API |
| `--page-all` | Auto-paginate all results (NDJSON output) |
| `--upload <PATH>` | Upload file content (multipart) |
| `--format <FMT>` | Output format: `json` (default), `table`, `yaml`, `csv` |

## Discovering commands

Always inspect before calling an unfamiliar method:

```bash
gws <service> --help
gws schema <service>.<resource>.<method>
```

## Gmail

```bash
# Send an email
gws gmail +send --to alice@example.com --subject "Hello" --body "Hi there"

# Unread inbox summary
gws gmail +triage

# Read a message body
gws gmail +read --message-id MESSAGE_ID

# Reply to a message (threading handled automatically)
gws gmail +reply --message-id MESSAGE_ID --body "Thanks!"

# Reply-all
gws gmail +reply-all --message-id MESSAGE_ID --body "Acknowledged"

# Forward a message
gws gmail +forward --message-id MESSAGE_ID --to bob@example.com

# Watch for new emails (streams NDJSON)
gws gmail +watch

# List messages via API
gws gmail users messages list --params '{"maxResults": 10}'
```

## Calendar

```bash
# Show upcoming events
gws calendar +agenda

# Show agenda in a specific timezone
gws calendar +agenda --timezone America/New_York

# Create an event
gws calendar +insert --title "Standup" --time "2026-05-02T09:00:00"

# List events via API
gws calendar events list --params '{"calendarId": "primary", "maxResults": 5}'

# Check free/busy
gws calendar freebusy query --json '{"timeMin": "...", "timeMax": "...", "items": [{"id": "primary"}]}'
```

## Drive

```bash
# List files
gws drive files list --params '{"pageSize": 10}'

# Upload a file
gws drive +upload ./report.pdf --name "Q1 Report"

# Download a file
gws drive files get --params '{"fileId": "FILE_ID", "alt": "media"}' -o output.pdf

# Search for files
gws drive files list --params '{"q": "name contains '\''budget'\''", "pageSize": 10}'

# Create a folder
gws drive files create --json '{"name": "Projects", "mimeType": "application/vnd.google-apps.folder"}'
```

## Sheets

```bash
# Read a range
gws sheets +read --spreadsheet SPREADSHEET_ID --range "Sheet1!A1:D10"

# Append a row
gws sheets +append --spreadsheet SPREADSHEET_ID --values "Alice,95,A"

# Read via API
gws sheets spreadsheets values get \
  --params '{"spreadsheetId": "ID", "range": "Sheet1!A1:C10"}'

# Append via API
gws sheets spreadsheets values append \
  --params '{"spreadsheetId": "ID", "range": "Sheet1!A1", "valueInputOption": "USER_ENTERED"}' \
  --json '{"values": [["Name", "Score"], ["Alice", 95]]}'

# Create a new spreadsheet
gws sheets spreadsheets create --json '{"properties": {"title": "Q1 Budget"}}'
```

## Docs

```bash
# Append text to a document
gws docs +write --document-id DOC_ID --text "New paragraph of text"

# Get document content
gws docs documents get --params '{"documentId": "DOC_ID"}'
```

## Chat

```bash
# Send a message to a space
gws chat +send --space-id spaces/SPACE_ID --text "Deploy complete."

# List spaces
gws chat spaces list
```

## Shell tips

- **zsh `!` expansion**: Sheet ranges like `Sheet1!A1` contain `!` which zsh interprets as history expansion. Always use double quotes for ranges:
  ```bash
  gws sheets +read --spreadsheet ID --range "Sheet1!A1:D10"
  ```
- **JSON quoting**: Wrap `--params` and `--json` values in single quotes so the shell doesn't interpret the inner double quotes.

## Safety rules

- Confirm with the user before executing write or delete operations.
- Prefer `--dry-run` for destructive operations until the user confirms.
- Never output secrets, API keys, or tokens directly.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | API error (4xx/5xx) |
| 2 | Auth error |
| 3 | Validation error |
| 4 | Discovery error |
| 5 | Internal error |

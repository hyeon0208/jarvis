---
name: jarvis-telegram
description: "Handles Jarvis requests over Telegram. Activates automatically when a <channel source=\"telegram\"> tag is detected, performing authentication, permission checks, and message routing. Can also be invoked manually via /jarvis-telegram."
---

# Jarvis Telegram Channel Handler

## Trigger

This skill activates when an incoming message contains a `<channel source="telegram" ...>` tag.

## Procedure

### Step 1: Parse message

Extract from the `<channel>` tag:
- `chat_id` — Telegram chat room ID
- `message_id` — Message ID
- `user` — Sender display name
- Message body

**User ID format**: `telegram:{chat_id}`

### Step 2: Gateway routing

Call the `jarvis_gateway_route` MCP tool:

```
jarvis_gateway_route(
  channel: "telegram",
  user_id: "telegram:{chat_id}",
  display_name: "{user}",
  message: "{message body}",
  message_id: "{message_id}",
  chat_id: "{chat_id}"
)
```

### Step 3: Handle result

Branch on the routing result's `action`:

#### `pairing_required` — unauthenticated user
Send the pairing instructions produced by the gateway to Telegram:
```
mcp__plugin_telegram_telegram__reply(
  chat_id: "{chat_id}",
  text: "{pairing instructions}"
)
```

#### `permission_denied` — insufficient permissions
Send the denial message to Telegram:
```
mcp__plugin_telegram_telegram__reply(
  chat_id: "{chat_id}",
  text: "{denial message}"
)
```

#### `respond` — system command response
Send the immediate response:
```
mcp__plugin_telegram_telegram__reply(
  chat_id: "{chat_id}",
  text: "{response text}"
)
```

#### `execute` — general request

1. Check the user's profile and personality settings
2. Handle the request according to profile permissions:
   - **observer**: question/search only — read code and generate answers only
   - **reviewer**: read + analyze — code review, PR analysis
   - **developer**: read/write — can modify code (sandbox cwd)
   - **owner**: full access (Owner only)
3. Generate the response honoring personality (tone, language, verbosity)
4. Send to Telegram:
```
mcp__plugin_telegram_telegram__reply(
  chat_id: "{chat_id}",
  text: "{result}"
)
```

### Step 4: Cron job handling

If the message is a `/cron` command, the routing result's response contains a cron action:

```json
{"action": "cron_add", "args": {"prompt": "daily 9am task summary"}}
```

In this case, call the `jarvis_cron_manage` MCP tool and send the result to Telegram.

## Pairing approval (Owner only)

How Owner approves pairings from the terminal:

```
/jarvis-telegram pair list                          → list pending pairings
/jarvis-telegram pair approve {code} {profile}      → approve
/jarvis-telegram pair reject {user_id}              → reject
```

Uses the `jarvis_gateway_pair` MCP tool.

## Subcommands

```
/jarvis-telegram status    → channel status
/jarvis-telegram pair list → list pairings
/jarvis-telegram pair approve {code} developer → approve
/jarvis-telegram pair reject {user_id} → reject
```

## MCP Tool Dependencies
- `jarvis_gateway_route` — message routing
- `jarvis_gateway_pair` — pairing management
- `jarvis_gateway_send` — message sending
- `jarvis_cron_manage` — cron job management
- `jarvis_sandbox_config` — sandbox configuration
- `mcp__plugin_telegram_telegram__reply` — send Telegram message
- `mcp__plugin_telegram_telegram__react` — add Telegram emoji reaction

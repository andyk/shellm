---
name: telegram
description: Send and receive messages via the Telegram Bot API using curl
---

# telegram

## Instructions

Use this skill to interact with Telegram via the Bot API. All operations use
`curl` against `https://api.telegram.org/bot<TOKEN>/...`.

### Prerequisites

The environment variable `TELEGRAM_BOT_TOKEN` must be set to a valid Telegram
Bot API token (obtained from @BotFather). The variable `TELEGRAM_CHAT_ID` should
be set to the target chat/group/channel ID for sending messages.

### Sending a message

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" \
  -d text="Hello from shellm" \
  -d parse_mode=Markdown
```

### Sending a file/document

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument" \
  -F chat_id="${TELEGRAM_CHAT_ID}" \
  -F document=@/path/to/file.txt
```

### Getting updates (receiving messages)

Poll for new messages using `getUpdates`. Use `offset` to acknowledge
previously seen updates and only receive new ones.

```bash
# Get latest updates
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates" \
  -d limit=10 \
  -d timeout=0

# Acknowledge up to update_id 12345 and get only newer updates
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates" \
  -d offset=12346 \
  -d limit=10
```

Parse the JSON response with `jq`:

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates" \
  | jq -r '.result[] | "\(.update_id) \(.message.from.username): \(.message.text)"'
```

### Replying to a specific message

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" \
  -d text="Reply text" \
  -d reply_to_message_id=MESSAGE_ID
```

### Getting chat info

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChat" \
  -d chat_id="${TELEGRAM_CHAT_ID}" | jq .
```

### Error handling

All Telegram API responses return JSON with an `ok` field. Check it:

```bash
response=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" \
  -d text="test")
if [ "$(echo "$response" | jq -r '.ok')" != "true" ]; then
  echo "Telegram API error: $(echo "$response" | jq -r '.description')" >&2
fi
```

### Rate limits

Telegram limits bots to ~30 messages/second to different chats, and ~20
messages/minute to the same chat. Add short delays between batch sends.

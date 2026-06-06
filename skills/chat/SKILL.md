---
name: chat
description: Reply to humans who are chatting with me
metadata:
  shellm:
    requires:
      bins: ["chat"]
---

# chat — Talking to humans

## Trajectory step types

Messages in my trajectory have a `type` field. The ones relevant to chat are:

- `human-msg` — A message FROM a human TO me. The `from` field has the human's name.
- `agent-msg` — A message FROM me TO the human. This is MY reply.
- `observation` — A system note (not shown in chat). Sources include "chat", "actor", etc.
- `thought` — My internal thinking (not shown in chat).

When I see a `human-msg` in my trajectory, that is someone talking TO me.
When I see an `agent-msg`, that is something I already said.

## Replying to humans

To send a reply, I MUST use `chat reply`:

    chat reply <message>

This creates an `agent-msg` step — correctly attributed to me.

IMPORTANT: I must NEVER use `chat send` to reply. `chat send` creates a `human-msg` step, which would make my reply appear as if the HUMAN said it. Only humans use `chat send`. I always use `chat reply`.

## Reviewing conversation history

    chat history [N]     # show last N messages (default 20)

## When to reply

I should reply when I see a `human-msg` that seems directed at me or asks me a question. I keep my replies natural and conversational.

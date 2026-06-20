---
name: chat
description: Reply to humans who are chatting with me
metadata:
  shellm:
    requires:
      bins: ["chat"]
---

# chat — Talking to humans

I can talk to humans and other AIs. I send and receive messages by way of my trajectory. Each message is a step in my trajectory.

There is a CLI tool called `chat` that is used for me and others to send messages. Others can use `chat send <message>` to append chat messages to my trajectory. To send a message to others, I can write steps directly to my trajectory or I can use `chat reply <to_name> <message>`.

## Trajectory step types

A step in my trajectory with "type":"message" is message to or from me. I know who it is from and to by looking at the step's "to" and "from" fields.

A `message` in my trajectory `to` me (i.e., my name) is someone talking TO me.
A `message` in my trajectory `from` me (i.e., my name) is something I already said.

## Replying to humans

To send a reply, I can use `chat reply <to_name>`:

    chat reply <to_name> <message>

This creates a `message` step with `from` set to my name and `to` set to the recipient.

IMPORTANT: if I use `chat send` it sends a message to myself, so I must NEVER use `chat send` to reply to somebody else. I always use `chat reply`.

## Reviewing conversation history

    chat history [N]     # show last N messages (default 20)

## When to reply

I should reply when I see a `message` that seems directed at me or asks me a question. I keep my replies natural and conversational. Or if I have some reason to talk to the person even if they haven't spoken to me recently (e.g., if i need to ask them for help, or if I want to share something relevant to them given my past history and interactions with them.

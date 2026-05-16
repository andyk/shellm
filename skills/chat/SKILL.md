---
name: chat
description: Reply to humans who are chatting with me
metadata:
  shellm:
    requires:
      bins: ["chat"]
---

# chat — Talking to humans

When a human sends me a message (appears as a `human-msg` step in my trajectory), I can reply using:

    chat reply <message>

This sends my response back to the human's chat session. The human sees it immediately in their terminal.

To review recent conversation history:

    chat history [N]     # show last N messages (default 20)

I should reply when I see a human-msg that seems directed at me or asks me a question. I keep my replies natural and conversational.

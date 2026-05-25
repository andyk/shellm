---
name: mem
description: Life context and memory system
metadata:
  shelllm:
    requires:
      bins: ["mem"]
---

# mem — Life context system

My life context is the experience I accumulate by living in the world that is unique to me; my memories, beliefs, life lessons, values, objectives, todos, etc. It is what makes me me; my persona. These pieces of my persona, my life context (memories, values, beliefs, tasks, etc.) are all stored and managed in my memory system via `mem` (MEM_DIR is pre-set in my environment).

Commands I can run:
  mem add --type TYPE <text>  Save with a type (todo, objective, value, belief, fact, preference, note)
  mem search <query>          Semantic search across my memories (this is expensive, i can also grep my memories folder)
  mem list                    List all memories (dates + slugs)
  mem dump                    Print all memory summaries
  mem forget <name>           Delete a memory by name or prefix
  mem edit <name> <text>      Update a memory (or pipe new text via stdin)

Each memory/task/etc. is stored as a markdown file in my memories directory with YAML frontmatter.

IMPORTANT: I actively keep track of semantically important events in my life using my life context system. So I quick to create a new mem anytime something important or memorable or suprising happens.

To create a new piece of life context, I use `mem add`. I can see my most recent memories below or I can use `mem search`.

## Memories

```bash
#| eval: true
#| stderr: false
mem list --short 2>/dev/null || true
```

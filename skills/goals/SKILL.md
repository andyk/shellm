---
name: goals
description: Goals, todos, and intentions tracking
metadata:
  shelllm:
    requires:
      bins: ["mem"]
---

# goals — Goals, todos, and intentions

I track my goals, todos, objectives, and intentions as part of my life context. These represent what I want to accomplish, what I'm working toward, and what matters to me.

## Types

- **goal** / **intention** — High-level aspirations and directions I want to move in
- **todo** — Concrete tasks I want to complete
- **objective** — Measurable outcomes I'm working toward

## Managing goals via `mem`

  mem add --type goal "learn to play piano"
  mem add --type todo "reply to Sarah's email"
  mem add --type objective "read 2 books this month"
  mem add --type intention "be more patient in conversations"
  mem list                    # see all memories including goals/todos
  mem edit <name> <text>      # update a goal
  mem forget <name>           # remove a completed todo or outdated goal

## Current goals and todos

```bash
#| eval: true
#| stderr: false
found=0
for f in "$MEM_DIR"/*.md; do
  [ -f "$f" ] || continue
  ftype=$(awk 'NR==1 && /^---$/{f=1; next} f && /^---$/{exit} f && /^type:/{sub(/^type:[[:space:]]*/, ""); print}' "$f")
  case "$ftype" in
    goal|intention|todo|objective)
      body=$(awk 'NR==1 && /^---$/{f=1; next} f && /^---$/{f=0; next} !f{print}' "$f" | sed '/./,$!d' | head -3)
      [ -n "$body" ] && { printf "- [%s] %s\n" "$ftype" "$body"; found=1; }
      ;;
  esac
done
[ "$found" -eq 0 ] && echo "(no goals or todos set)"
```

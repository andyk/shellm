# Decision ledger

Append-only record of what each generation proposed and what became of it. This is the loop's anti-whiplash memory: `decide.sh` appends a line per reviewed card, the implementation handoff updates verdicts, and `critique.sh`/`synthesize.sh` feed recent entries back to the LLM so it doesn't re-propose applied fixes, revert recent ones on thin evidence, or resurrect declined cards. Unlike `generations/` (gitignored, disposable), this file is committed.

Line format:

```
- <date> <gen> ACCEPTED <card-slug> → <target> — pending implementation
- <date> <gen> ACCEPTED <card-slug> → <target> — IMPLEMENTED|REVISED|REJECTED: <one-line reason>   (updated by the verifier)
- <date> <gen> SKIPPED  <card-slug> → <target> — <optional human note>
```

*(Pre-ledger history: two validation generations ran on 2026-07-08 and were reset; their findings are summarized in [design/overview.md](design/overview.md). The `thinkers stop` process leak was diagnosed and fixed outside the loop — see [log.md](log.md).)*

## Entries
- 2026-07-08 gen-002 ACCEPTED 01-extract-action-lines-from-thoughts → thinkers/inner_monologue/step — IMPLEMENTED: step now extracts line-leading `action:` lines from thought bodies into real action steps (thought kept, or skipped if emptied)
- 2026-07-08 gen-002 ACCEPTED 02-recall-before-paraphrase → thinkers/inner_monologue/prompt.md — IMPLEMENTED: added "Recalling" section — read via mem search/show before building on past-you's conclusions
- 2026-07-08 gen-002 ACCEPTED 03-save-distilled-beliefs-reflex → thinkers/inner_monologue/prompt.md — REVISED: existing "Committing" section already covered this (present during g002r3 and missed); added a "crystallized belief → mem add" trigger bullet there instead of a duplicate section
- 2026-07-08 gen-002 ACCEPTED 04-quiescence-over-filler → thinkers/inner_monologue/prompt.md — REVISED: card's `[idle]` token would append as a literal thought; reused the existing `idle` mechanism (no-traj-append wait) by allowing idle when the next thought would only restate, plus "new threads start from real signals, never invented pretexts"; dropped the `mem list --type goal` clause (goals aren't in monologue context)
- 2026-07-08 gen-002 ACCEPTED 05-audit-injected-skills-context → thinkers/inner_monologue/prompt.md — REVISED: manifest is injected by `skills prompt` via common.sh (not prompt.md), and the confabulated names (cowsay/my-skill) aren't even in it — they're examples inside skill-author's SKILL.md body, which is never injected; per the card's own fallback, added only the "Reference vs. observation" rule to prompt.md, no harness wrapper

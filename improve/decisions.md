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

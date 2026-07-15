# Model resolution

**Status:** Current behavior (documented 2026-07-15)

How every LLM call in shellm decides which model to use, and where the
environment variables that feed that decision come from. Two layers:

1. **Resolution** — each call site walks a precedence chain of flags and
   env vars until one is set.
2. **Population** — the env vars themselves are filled in from `.env`
   files, with different (deliberate) merge semantics per tool.

There is no hard provider dependency anywhere: `bin/llm` picks the
provider from the model name (`claude-*` → Anthropic, `vendor/model` →
OpenRouter, `gpt-*`/`o*` → OpenAI, `gemini-*` → Gemini) and each provider
needs only its own `<PROVIDER>_API_KEY`. Hardcoded `claude-*` names below
are last-resort defaults, reached only when nothing is configured.

## The knobs

| Variable | Meaning |
|---|---|
| `SHELLM_MODEL` | The system-wide model: agent loops and the default for everything below |
| `SHELLM_FAST_MODEL` | Optional cheap class for utility calls (summaries, `mem search`). Set it when `SHELLM_MODEL` is expensive; skip it when it's already cheap |
| `THINK_MODEL` | Per-thinker override (also settable per identity via `info.txt think_model=`) |
| `SHELLM_SUMMARY_MODEL` | Run-summary override; beats `SHELLM_FAST_MODEL` |
| `LLM_MODEL` | `bin/llm`'s own knob; equivalent to `-m` |

## Resolution chains

Left to right, first set value wins:

| Call site | Resolution chain |
|---|---|
| `mem search` | `SHELLM_FAST_MODEL` → `SHELLM_MODEL` → `claude-sonnet-4-5` |
| bare `llm` (no `-m`) | `-m` flag → `LLM_MODEL` → `SHELLM_MODEL` → `claude-sonnet-4-5` |
| run summaries (`bin/shellm`) | `SHELLM_SUMMARY_MODEL` → `SHELLM_FAST_MODEL` → *if run is `claude-*`*: `claude-haiku-4-5` / *else*: the run's own `SHELLM_MODEL` |
| `shellm` agent loop | `--model` flag → `SHELLM_MODEL` → `claude-opus-4-7` |
| thinkers (all) | `THINK_MODEL` → `SHELLM_MODEL` → `claude-opus-4-7` |
| web-started thinkers | `info.txt think_model=` → server-env `SHELLM_MODEL` → *(left unset — the step resolves as the thinker row above)* |
| `shellm-explore` report | `--model` flag → `SHELLM_MODEL` → `claude-opus-4-7` |
| `identity create` | `SHELLM_MODEL` → `claude-opus-4-7` |

The summary chain's provider split exists so that a non-Anthropic
deployment never falls back to a `claude-*` model it has no key for,
while Anthropic runs keep haiku's cheap summaries.

## Where the variables come from (.env population)

Two merge semantics, and the difference is deliberate:

- **`bin/llm` and `bin/shellm`** source the first `.env` found — cwd,
  else `~/.shellm/.env` (first found wins entirely; no merging) — and it
  **overwrites** already-exported vars. On a deployed box the service's
  working directory is the app root, so `/opt/shellm/app/.env` is
  authoritative for these tools.
- **Thinker step scripts** (`thinkers/_lib/common.sh`) fill in only
  *missing* vars, trying `$IDENTITY_DIR/.env` → cwd `.env` →
  `~/.shellm/.env`. Real environment always beats files here because the
  web control plane's env wrapper has already sourced root + identity
  `.env` (identity wins) before the dispatcher starts — a clobbering
  loader in the step would let the root `.env` stomp identity-level
  overrides that were already applied.

Consequences worth knowing:

- A `SHELLM_MODEL=` line in cwd's `.env` silently beats an inline
  `SHELLM_MODEL=x shellm ...` for `llm`/`shellm` (but not for thinkers).
- Rotating an API *key* in the box's `.env` takes effect on the next LLM
  call (`llm`/`shellm` re-source per invocation). Changing `SHELLM_MODEL`
  needs a thinker stop/start: running dispatchers export the model they
  started with.
- Identity-level `.env` overrides root for thinkers — if one identity
  mysteriously uses a different model/key, look there.

## Choosing values (cost)

`SHELLM_MODEL` is the persona-quality knob; `SHELLM_FAST_MODEL` is the
cost knob. Utility traffic (summaries, memory search) is structured and
cheap-model-tolerant; background thinkers are the volume driver and stay
on the smart tier by default — pointing them at a cheap tier via
`THINK_MODEL` is a per-deployment persona decision, not a code default.
Examples:

```bash
# Anthropic, cost-conscious
SHELLM_MODEL=claude-opus-4-7
SHELLM_FAST_MODEL=claude-haiku-4-5

# OpenRouter, everything cheap (tiers pointless)
SHELLM_MODEL=openai/gpt-oss-120b

# Mixed quality: smart actor, cheap utilities
SHELLM_MODEL=z-ai/glm-5.2
SHELLM_FAST_MODEL=openai/gpt-oss-120b
```

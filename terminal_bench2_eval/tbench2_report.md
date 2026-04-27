# shellm Terminal Bench 2.0 Evaluation Report

**Date:** 2026-04-26
**Model:** claude-opus-4-7
**Settings:** effort=max, max-iterations=1000, max-depth=1000
**Harness:** harbor 0.5.0 with custom ShellmDockerEnvironment

## Results Summary

| Metric | Value |
|--------|-------|
| Tasks completed | 60 / 89 (67%) |
| Tasks passed | 23 / 60 (38.3%) |
| Tasks failed | 37 / 60 (61.7%) |
| Tasks not run (cancelled) | 29 |
| Estimated full-run pass rate | ~35-40% |

## Passing Tasks (23)

| Task | Category |
|------|----------|
| build-pov-ray | build/compile |
| code-from-image | code generation |
| compile-compcert | build/compile |
| count-dataset-tokens | data processing |
| crack-7z-hash | security |
| custom-memory-heap-crash | systems/debugging |
| extract-elf | reverse engineering |
| fix-code-vulnerability | security |
| fix-git | git/version control |
| git-multibranch | git/version control |
| headless-terminal | systems |
| hf-model-inference | ML/inference |
| kv-store-grpc | systems/networking |
| largest-eigenval | scientific computing |
| log-summary-date-ranges | data processing |
| mailman | systems/email |
| merge-diff-arc-agi-task | data processing |
| modernize-scientific-stack | refactoring |
| mteb-retrieve | ML/retrieval |
| multi-source-data-merger | data processing |
| password-recovery | security |
| portfolio-optimization | scientific computing |
| prove-plus-comm | formal verification |

## Failing Tasks (37)

| Task | Likely failure mode |
|------|-------------------|
| adaptive-rejection-sampler | Complex scientific computing |
| break-filter-js-from-html | Web/parsing |
| caffe-cifar-10 | ML training (resource/time intensive) |
| chess-best-move | Game AI/search |
| circuit-fibsqrt | Hardware/circuit design |
| cobol-modernization | Legacy code |
| configure-git-webserver | Systems config |
| db-wal-recovery | Database internals |
| distribution-search | Statistics |
| extract-moves-from-video | Video processing (resource intensive) |
| feal-linear-cryptanalysis | Cryptography |
| gcode-to-text | Domain-specific parsing |
| gpt2-codegolf | ML/code golf (extremely hard) |
| install-windows-3.11 | OS installation (QEMU) |
| llm-inference-batching-scheduler | ML systems |
| make-doom-for-mips | Cross-compilation |
| make-mips-interpreter | Systems/emulation |
| mteb-leaderboard | ML/evaluation |
| overfull-hbox | LaTeX |
| path-tracing | Graphics/rendering |
| path-tracing-reverse | Graphics/rendering |
| polyglot-rust-c | Multi-language |
| pypi-server | Package management |
| pytorch-model-cli | ML tooling |
| qemu-alpine-ssh | Virtualization |
| qemu-startup | Virtualization |
| raman-fitting | Scientific computing |
| regex-chess | Regex/games |
| reshard-c4-data | Data engineering |
| schemelike-metacircular-eval | PL/interpreters |
| torch-pipeline-parallelism | ML distributed training |
| torch-tensor-parallelism | ML distributed training |
| train-fasttext | ML training |
| tune-mjcf | Physics simulation |
| video-processing | Video (resource intensive) |
| winning-avg-corewars | Game AI |
| write-compressor | Compression algorithms |

## Bugs Found and Fixed During Evaluation

8 bugs were discovered and fixed during the harness development:

1. **Missing docker-compose plugin** — Harbor requires `docker compose` (v2) but the DinD container only had the Docker daemon. Fixed by downloading the official docker-compose binary.

2. **Cgroup v2 threading conflict** — Harbor's `deploy.resources.limits` in docker-compose triggers cgroup errors in nested Docker. Fixed with `ShellmDockerEnvironment` that emits a `!reset {}` compose override.

3. **Missing sibling scripts** — shellm depends on `llm`, `shellm-docker`, `shellm-docker-broker`, and `shellm-explore`. The original harness only uploaded `shellm`. Fixed by uploading all siblings.

4. **Model name prefix** — Harbor passes model names as `anthropic/claude-opus-4-7` but shellm's `llm` script expects bare `claude-opus-4-7`. Fixed by stripping provider prefixes.

5. **`--` separator rejected** — shellm doesn't accept `--` before the prompt argument. Removed from the command construction.

6. **claude-opus-4-5 incompatible with effort=max** — Extended thinking with `effort=max` is not supported on claude-opus-4-5. Switched to `claude-opus-4-7`.

7. **Docker CLI version mismatch** — The distro `docker.io` package (v23) is too old for the host daemon (v29). Fixed by installing the official Docker 29.1.3 static binary.

8. **DinD isolation prevents task access** — shellm with `--docker-access dind` (or even `none` with `SHELLM_ALLOW_NESTED_DOCKER=1`) creates a separate container, making the task's `/app/` filesystem inaccessible. Fixed by NOT setting `SHELLM_ALLOW_NESTED_DOCKER` at the top level, so shellm detects `/.dockerenv` and falls back to local execution inside the task container.

## Recommendations to Improve Performance

### High Impact

1. **Handle thinking-only API responses gracefully.** When the model produces only thinking content (no text block), shellm dies with "Empty response from Claude API." This was observed on multiple tasks. shellm should retry with a reduced thinking budget or a prompt nudge like "Please provide a bash code block."

2. **Increase `max_tokens` for effort=max.** With `effort=max`, the model can exhaust its token budget on thinking before generating the bash response. Increasing `SHELLM_MAX_TOKENS` to 32000+ would give more headroom.

3. **Add `--workdir` support in the harness.** Many tasks have their files at `/app/<task-name>/` rather than `/app/`. Passing `--workdir /app` to shellm would help it find task files immediately instead of spending iterations searching.

4. **Reduce effort for simple exploration iterations.** The first few iterations are typically exploratory (ls, pwd, find). Using `effort=high` instead of `max` for early iterations would be faster and cheaper, reserving `max` for complex reasoning.

### Medium Impact

5. **Retry failed tasks.** Harbor supports `--max-retries`. Many failures were due to transient issues (empty API responses, timeouts). A single retry could recover 5-10% of failures.

6. **Task-specific timeout tuning.** Easy tasks (5-min expert time) don't need 900s agent timeout. Hard tasks (2400-min expert time) might benefit from longer timeouts. Scaling timeout by task difficulty would improve throughput.

7. **Reduce inactivity timeout for faster failure detection.** The default 300s inactivity timeout means shellm waits 5 minutes when a command hangs. Reducing to 60-120s for most tasks would speed up failure recovery.

### Lower Impact

8. **Pre-install common tools in task containers.** Many tasks need git, python3, build tools. Pre-installing these in the agent setup would save time on every task.

9. **Use `--docker-access socket` for recursive calls instead of `dind`.** Socket mode is faster than DinD (no inner daemon startup) and still provides container isolation. DinD adds 30-60s of setup per recursive call.

10. **Add structured output parsing.** When shellm sets `FINAL`, it should be captured and logged separately from the full stdout stream. This would improve verifier compatibility and debugging.

## Architecture Notes

The final working architecture:

```
Harbor (host) → Docker task container (fix-git, etc.)
                 └─ shellm (local execution, --docker-access none)
                     └─ code runs directly in task container's /app/
                     └─ recursive shellm calls → DinD containers (isolated)
```

Key insight: the top-level shellm MUST run locally inside the task container (not in a separate Docker container) so it can access the task's filesystem. Recursive sub-calls use DinD for isolation. This is achieved by NOT setting `SHELLM_ALLOW_NESTED_DOCKER=1` at the top level.

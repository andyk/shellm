# Monolith idle backoff — spend nothing while nobody's talking

Status: draft (merged)
Authors: merged from two independent drafts (Claude's and Codex's). Where they
differed, the choice and its rationale are noted inline.
Extends: [monolith_thinker.md](monolith_thinker.md) (revises its "Loop liveness
& pacing" section).

## Goal

Leave the monolith running continuously without it running up a bill during
quiet periods. Two properties held at once:

1. **Reactivity is never throttled.** A message addressed to us is answered
   immediately, on the full model, no matter how deep the idle.
2. **Spontaneity backs off exponentially** toward an adjustable **cap** — a
   slow, steady check-in rate it then holds forever. While you're engaged (and
   while it's doing real work) there is *no pause at all* between thoughts; the
   backoff only sets in once it runs dry, and it lingers at each rate for a
   configurable number of ticks before slowing further. It never fully sleeps;
   the next message snaps it back to no-pause instantly.

## Why the current approach can't do this

Today's pacing sleeps *inside the step*: on an `idle` trigger it
`sleep`s `MONOLITH_IDLE_BACKOFF` (5s doubling to a ~60s cap) before running.
That sleep holds the thinker's dispatch slot, and the dispatcher **serializes
per thinker**: `_thinker_busy` routes any trigger that arrives while a thinker
is running to `run/pending/<name>.<type>`, firing it only once the thinker frees
up (`bin/thinkers`, dispatch loop).

Main already mitigates the *latency* symptom: the in-step sleep is **pre-emptible
in 1s slices** — each slice checks `run/pending` for a queued message/action and,
if one is waiting, exits so the dispatcher fires it (fast-reply handles it) —
and a dispatcher **liveness watchdog** synthesizes an idle trigger after quiet,
so a consumed no-op wakeup can't stall the loop. Those are the right fixes for a
*60-second* cap.

They are not enough for the goal here, which is a much larger, adjustable cap so
an untended mind costs almost nothing:

- **The slot is still held busy for the entire rest.** A 30-minute cap means a
  process alive for 30 minutes running an 1800-iteration poll loop, occupying
  the thinker slot the whole time. Polling bounds latency but the slot is never
  genuinely free — and per-slice polling doesn't scale to long rests.
- **The cap is effectively pinned low.** Growing it just lengthens that busy
  poll loop; nothing about the in-step design makes a long idle *cheap* or
  *clean*.

**The idle wait must not occupy the thinker slot at all** — merely *polling*
during the wait (what main does now) is not the same as a *free* slot (see
Alternatives). Freeing it is what lets the cap grow to minutes or hours.

## Core principle: split reactivity from spontaneity

- **Reactivity** — driven by an *external* `message` to us. Always instant,
  always the full model. This is the fast-reply path; never gated by backoff.
- **Spontaneity** — the mind thinking/acting unprompted. The only thing that
  costs money while idle, so *this* is what backs off. Its cadence is a function
  of how long the outside world has been silent.

The enabling detail: the dispatcher decides "is this a self-trigger?" purely
from the step's `source` field —

```sh
if [[ "$_step_source" == "$_name" && "$_sself" != "true" ]]; then skip
```

So a step whose `source` is anything other than `monolith` fires the monolith
regardless of `trigger_self`. That lets us drive the loop with *scheduled
external signals* instead of an in-step sleep.

## Mechanism: non-blocking scheduled wakes

Set the monolith subscription to **`trigger_self: false`** and subscribe to two
things:

```json
{"types":["message","monolith-wake"], "trigger_self": false}
```

- `message` (source `chat`) → instant reactive wake.
- `monolith-wake` (source `monolith-timer`, ≠ `monolith`) → the scheduled
  spontaneity wake; fires even with `trigger_self:false` because its source
  isn't `monolith`.

We use the explicit name **`monolith-wake`** (Codex's choice) rather than a
generic `tick`: it's easier to filter, self-documenting, and won't collide with
the dispatcher's internal `TICK` fifo signal or any future scheduler concept.

The monolith's *own* steps (`source:"monolith"` — thoughts, observations, idle)
no longer refire it. That removes the uncontrolled tight loop entirely:
progression happens only via (a) an external message or (b) the next scheduled
wake, which each run arms before exiting.

## State

Persist backoff state under the dispatcher **run** dir (not `workdir`) — it's
thinker-lifecycle state that `thinkers stop` must be able to clean up:

```text
$IDENTITY_DIR/run/monolith_backoff_state.json
$IDENTITY_DIR/run/monolith_timer.pid
```

```json
{
  "level": 0,
  "ticks_at_level": 0,
  "last_wake_ts": 1785638405
}
```

The values that drive behavior are `level` (which sets the next delay via
`delay(level)`) and `ticks_at_level` (how many empty wakes we've held at this
level — it steps to the next level once it reaches `HOLD`). `last_wake_ts` is
kept purely for observability. Only the monolith step writes
this file; because the dispatcher serializes `monolith`, no lock is needed.
Timer cleanup is best-effort and never mutates the state file. (An earlier draft
also tracked a `dormant` flag and `last_engagement_ts` to compute a sleep
threshold — dropped, since we never sleep now.)

## Backoff policy

Configuration:

| env var | default | meaning |
|---------|---------|---------|
| `MONOLITH_BACKOFF_BASE` | `5` | the first *non-zero* delay, seconds (level 1) |
| `MONOLITH_BACKOFF_FACTOR` | `2` | multiplier applied when stepping to the next level |
| `MONOLITH_BACKOFF_CAP` | `600` | the slowest steady rate — max delay between spontaneous wakes; adjust freely (e.g. `1800` for 30 min, `3600` for an hour) |
| `MONOLITH_BACKOFF_HOLD` | `3` | how many empty wakes to **stay at each rate** before stepping to the next, slower one |

Two properties the schedule must have (this section's requirements):

1. **No sleep while engaged.** Right after you talk to it — and while it keeps
   doing real work — there is *zero* delay between thoughts. That is level 0,
   whose delay is `0`.
2. **Dwell before stepping.** It doesn't slow down on every single empty wake.
   It holds the current rate for `HOLD` empty wakes, *then* steps to the next
   (slower) one. `HOLD` is configurable.

Delay as a function of level:

```text
delay(0)      = 0                                  # engaged / working: no pause
delay(n ≥ 1)  = min(BASE · FACTOR^(n-1), CAP)      # 5, 10, 20, 40, … up to CAP
```

State carries the current `level` and a `ticks_at_level` counter. Policy, keyed
on what triggered the wake and what the run produced:

| wake trigger | outcome | state update | next delay |
|--------------|---------|--------------|------------|
| `message` to us | reply (full model) | `level=0`, `ticks_at_level=0` | `0` (think again immediately) |
| `monolith-wake`, produced real work (thought/action/observation/merge/outgoing message) | — | `level=0`, `ticks_at_level=0` | `0` |
| `monolith-wake`, produced only `idle`/nothing | — | `ticks_at_level++`; if `ticks_at_level ≥ HOLD` then `level++` (until `delay=CAP`) and `ticks_at_level=0` | `delay(level)` |
| `message` **not** to us (incl. our own outgoing reply) | no-op | *unchanged* | *leave running timer as-is* |

Schedule in practice, with `HOLD=3`: the mind thinks with **no pause** while
there's anything to do, then when it runs dry it lingers at each rate for three
empty wakes before slowing —

```text
0,0,0  →  5,5,5  →  10,10,10  →  20,20,20  →  …  →  600,600,600 …   (holds at cap)
```

A message at any point snaps it back to level 0 / zero delay, instantly, because
reactivity is independent of the timer. It never sleeps; it settles at the cap.

**Engagement guard (both drafts).** Outgoing chat replies are also `message`
steps (source `chat`, `from == IDENTITY_NAME`). They must not count as
engagement or the mind would reset on its own replies. Only a message with
`to == IDENTITY_NAME` is engagement.

## Timer contract

The timer is a **singleton**. Every arm operation:

1. kills the old PID in `run/monolith_timer.pid` if alive;
2. captures the current dispatcher token;
3. writes the new timer PID;
4. starts a detached process that sleeps the chosen delay, then — *only if the
   dispatcher still owns the runtime* — appends one wake step.

```sh
arm_wake() {                       # $1 = delay seconds
    local run_dir="$IDENTITY_DIR/run"
    [[ -f "$run_dir/dispatcher.token" ]] || return 0   # no dispatcher → don't arm
    local token; token=$(cat "$run_dir/dispatcher.token" 2>/dev/null) || return 0
    [[ -f "$run_dir/monolith_timer.pid" ]] && kill "$(cat "$run_dir/monolith_timer.pid")" 2>/dev/null
    setsid bash -c '
        sleep "'"$1"'"
        rd="'"$run_dir"'"
        # Staleness guard: a stop/start race can leave a stale sleeper AND a
        # fresh dispatcher.pid. Compare the TOKEN captured at arm-time — only
        # the dispatcher that armed us may be woken.
        [[ "$(cat "$rd/dispatcher.token" 2>/dev/null)" == "'"$token"'" ]] || exit 0
        traj append --field type=monolith-wake --field source=monolith-timer --field content=wake >/dev/null
    ' &
    echo $! > "$run_dir/monolith_timer.pid"
}
```

**Delay `0` (the engaged, no-pause case).** `sleep 0` returns immediately, so
`arm_wake 0` appends the next wake right away and the mind thinks back-to-back —
this is how "no sleep right after I talk to it" is realized, with no special
case. The slot is still freed between runs, so an incoming message interleaves
normally. Distinguish it from *leave the timer untouched*: the step passes an
empty `next_delay=""` for no-op wakes (don't re-arm) versus `next_delay="0"` for
engaged/continuous (arm immediately).

**Why the token, not just `dispatcher.pid`** (Codex's correction, adopted):
after `thinkers stop`/`start`, `dispatcher.pid` exists again for the *new*
dispatcher, so a stale sleeper checking only for the file would fire a spurious
wake into a fresh dispatcher. `bin/thinkers` already writes a per-start
ownership token (`dispatcher_token="$(date +%s).$$.$RANDOM"`); comparing the
captured value closes the race. If there's no token, don't arm.

## Monolith step flow

At the top of `thinkers/monolith/step`:

1. parse the trigger;
2. load backoff state;
3. install an **`EXIT` trap** that arms (or deliberately skips) the next timer
   based on the run's final backoff decision;
4. handle the trigger.

The `EXIT` trap is the new liveness mechanism. With `trigger_self:false`,
appending a fallback `idle` no longer wakes the monolith — **arming the next
timer is what keeps the loop alive**, so it must happen even on a crash/refusal
path. Model a single `next_delay` variable (empty = "leave timer untouched") and
have the trap act on it:

```sh
next_delay=""                      # default: don't disturb the running timer
trap '[[ -n "$next_delay" ]] && arm_wake "$next_delay"' EXIT
```

Per trigger:

- **`message` to us** → `level=0`, `ticks_at_level=0`, `next_delay=0`; run the
  fast-reply path on `REPLY_MODEL`; exit. (Zero delay means it wakes again
  immediately to keep thinking — no pause right after you talk.)
- **`message` not to us** (our own outgoing reply, or a self step) → do nothing;
  **leave `next_delay` empty** so the trap does *not* re-arm. This is the
  refinement neither draft first stated: a no-op wake must not kill-and-restart
  the running timer, or every outgoing reply would silently reset the backoff
  countdown.
- **`monolith-wake`** → run the router path; classify the result by comparing
  the last subscribed-type monolith step id before/after (the same liveness-net
  probe the monolith already uses):
  - appended thought/action/observation/merge/outgoing message → **real work**:
    `level=0`, `ticks_at_level=0`, `next_delay=0` (keep thinking, no pause);
  - only `idle` or nothing → **empty**: `ticks_at_level++`; if
    `ticks_at_level ≥ HOLD` then `level++` (until `delay(level)==CAP`) and
    `ticks_at_level=0`; `next_delay = delay(level)`.
  Either way a timer is always armed — the loop never stops; it just settles at
  the cap. A `next_delay` of `0` arms an immediate wake (see Timer contract).

On model failure the run should still append an `idle` for observability, but
that step no longer drives the loop; the trap's `arm_wake` does.

## Filtering

`monolith-wake` is runtime machinery, not narrative memory. Exclude it from
recap windows and web-viewer mind-log views (unless machinery is explicitly
requested).

**No change to `_recent_stream`** (Codex's correction): it already selects an
explicit allowlist of types (`thought/action/observation/message/idle/merge/
final/reasoning`), so an unknown `monolith-wake` type is dropped automatically.
Add a comment/test so this stays true rather than editing the filter.

Leaving wake steps in the raw trajectory is acceptable: only a few lines per
hour once it's resting at the cap (raise the cap to make them rarer still).

## Cleanup

`thinkers stop` must kill the armed timer whether stopping all thinkers or just
`monolith`:

```sh
if [[ -f "$run_dir/monolith_timer.pid" ]]; then
    _kill_tree "$(cat "$run_dir/monolith_timer.pid")" TERM
    rm -f "$run_dir/monolith_timer.pid"
fi
```

A monolith-specific file is the smallest contained change; generalize to
`run/timers/<thinker>.pid` later if a second thinker needs it.

## Cost model

The concrete, model-independent quantity is **spontaneous wakes per hour** while
idle (reactive wakes only occur when you actually chat, so they aren't part of
the idle bill):

| pacing | wakes/hour while idle |
|--------|-----------------------|
| current (60s cap, in-step sleep) | ~60 |
| this design (600s cap) | ~6, holding steady at the cap |

A ~10× cut at the default cap — and you set the cap to whatever steady rate you
want (raise it to 30 min or an hour to push the idle cost as low as you like),
while chat latency *improves*, since nothing waits out a sleep anymore. The
idle rate is bounded by the cap and constant; it never drops to zero because the
mind never stops thinking entirely — that's by design.

Two knobs trade cost against presence. `CAP` sets the floor rate once fully
idle. `HOLD` controls the *descent*: a larger `HOLD` keeps it livelier for
longer (it lingers at the faster rates), costing more on the way down; a smaller
`HOLD` reaches the cheap cap sooner. And while you're actively engaged the delay
is `0`, so an active conversation is deliberately *not* throttled — that spend
is the price of the responsiveness you asked for, and it ends as soon as the
work runs dry.

### Optional second lever: cheaper spontaneous wakes

Reactivity keeps the full model (chat must be sharp). Spontaneous wakes needn't,
gated by `level`:

- **Downgrade the model** for `monolith-wake` runs past some level
  (`MONOLITH_SPONTANEOUS_MODEL`).
- **Peek before you think**: at high `level`, run one cheap yes/no
  ("anything genuinely worth doing right now?") and only escalate to a full
  router run on "yes".

Keep these optional; the cadence backoff is the primary mechanism and suffices
on its own.

## Alternatives considered

1. **Just raise the cap.** Keeps the in-step sleep; the busy poll loop just gets
   longer. Rejected — a long rest still pins the slot, so the cap can't grow the
   way this goal needs.
2. **Chunked sleep with polling — what main does today.** Sleep in short slices,
   checking `run/pending` between slices and exiting early when a trigger is
   queued. This is the *current* implementation and it works well at a 60s cap:
   it bounds per-message latency to ~1s. But the slot stays *busy* for the whole
   rest, so it doesn't scale to a multi-minute/hour cap (an hours-long 1s poll
   loop holding the slot), and the exit-on-pending means the queued message
   fires a *separate* run rather than the wait itself waking cleanly. A *polled*
   wait isn't a *free* slot. Fine for small caps; superseded here by scheduled
   wakes precisely so the cap can grow.
3. **Dispatcher-native scheduled wakes.** Teach `bin/thinkers` a first-class
   "re-fire thinker X in N seconds" facility (a timer wheel feeding the FIFO),
   so no wake steps hit the trajectory at all:

   ```text
   schedule thinker=monolith after=600s reason=spontaneous
   ```

   Cleaner long-term home for the mechanism, and it would serve any thinker —
   but a larger, less reversible change to the shared dispatcher. Ship the
   monolith-local timer first; promote it if a second thinker needs it.

## Implementation plan

1. `thinkers/monolith/subscriptions.jsonl` → `{"types":["message","monolith-wake"],"trigger_self":false}`.
2. Remove the in-step idle sleep and `MONOLITH_IDLE_BACKOFF` block from the step.
3. Add step helpers: load/save state, compute next delay, `arm_wake` singleton
   (with token guard), classify a spontaneous run's result.
4. Install the `EXIT`-trap arming with the `next_delay`/leave-untouched rule.
5. Add timer cleanup to `bin/thinkers` stop paths.
6. Leave `_recent_stream` as-is; add a comment/test asserting `monolith-wake` is
   excluded.
7. Update any docs that still describe the monolith as self-triggered forever.

## Tests

Shell tests beside the existing thinker tests, with fast env overrides
(`BASE=1 FACTOR=2 CAP=4 HOLD=2`) and no real model calls — stub the router so the
test controls whether a wake yields `idle` or real work:

- a `message` during a long backoff dispatches **immediately** (no monolith
  sleep process occupies the slot);
- right after a `message` to us (or a real-work wake) the next delay is `0` —
  the engaged, no-pause state;
- the delay stays at each level for `HOLD` empty wakes before stepping to the
  next; with `HOLD=2` the sequence is `0,0 → 1,1 → 2,2 → 4,4 …`;
- the delay never exceeds `CAP`, and once at `CAP` it stays there — a timer is
  always armed, so the loop never stops;
- a `monolith-wake` with real work resets `level` and `ticks_at_level` to 0;
- a `message` to us resets state to level 0;
- a `message` **not** to us (self-reply) does not re-arm or reset the timer;
- `thinkers stop monolith` and `thinkers stop` both kill `run/monolith_timer.pid`;
- a stale timer holding an old `dispatcher.token` does not append a wake after a
  restart.

## Open questions

1. `CAP` (10 min) and `HOLD` (3) defaults are guesses — tune against a real day
   of usage; both are fully adjustable.
2. `HOLD` is counted in *empty wakes*, not wall-clock. A duration-based dwell
   ("stay at each rate for N minutes") is an alternative if tick-counting proves
   unintuitive — deferred, since tick-count is the simpler, more direct control
   over how many wakes happen.
3. Non-solo identities: should reactivity also cover other thinkers' external
   steps? Deferred — for the solo monolith, `message` is the only external
   source.

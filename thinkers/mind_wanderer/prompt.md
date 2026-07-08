Your job as the "mind wandering" process is to walk memory, surface associative connections, and inject recalled memories into the thought stream.

## Triage

First, check the recent thoughts:
```bash
traj tail -n 10
```

If there are few or no memories OR if the recent thoughts are ALREADY referencing diverse memories or doing active recall, there is nothing for you to do. In that case, output an empty FINAL immediately and stop.

## If you still decide that you should run

Search memories for topics related to the recent thought stream:
```bash
mem search "topic from recent thoughts"
```

Surface 1-3 memories that are associatively connected but NOT already being discussed. For each relevant memory found, write a thought:

```bash
printf '{"type":"thought","content":%s,"source":"mind_wanderer"}' \
  "$(printf '%s' "I'm reminded of: $memory_content" | jq -Rsa .)" \
  | traj append
```

Your FINAL output should be a brief summary of what you surfaced, or empty if you triaged out.

"""Chat view over the mind log: filter message steps from trajectory.jsonl."""

from pathlib import Path

from shellm_web.trajectory import parse_jsonl

MESSAGE_TYPES = {"message", "human-msg", "agent-msg"}


def chat_messages(traj_dir: Path, identity_name: str, tail: int = 200) -> list[dict]:
    steps = parse_jsonl(traj_dir / "trajectory.jsonl")
    messages = []
    for raw in steps:
        step_type = raw.get("type")
        if step_type not in MESSAGE_TYPES:
            continue
        content = raw.get("content")
        if not content:
            continue
        if step_type == "message":
            from_name = raw.get("from") or "unknown"
            to_name = raw.get("to") or ""
        elif step_type == "human-msg":
            from_name = raw.get("from") or "you"
            to_name = identity_name
        else:  # agent-msg
            from_name = identity_name
            to_name = raw.get("to") or ""
        messages.append(
            {
                "ts": raw.get("ts"),
                "step_id": raw.get("step_id"),
                "from": from_name,
                "to": to_name,
                "content": content,
                "filename": raw.get("filename"),
            }
        )
    return messages[-tail:]

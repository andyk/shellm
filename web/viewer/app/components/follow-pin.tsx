import { ArrowDownToLine, Pause } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const BOTTOM_THRESHOLD_PX = 80;

/**
 * Follow-mode pill: while pinned to the bottom, new steps auto-scroll into
 * view; scrolling up unpins and shows how many new steps arrived.
 */
export function FollowPin({
  live,
  stepCount,
}: {
  live: boolean;
  stepCount: number;
}) {
  const [pinned, setPinned] = useState(true);
  const lastSeenCount = useRef(stepCount);
  const [missed, setMissed] = useState(0);
  const didInitialJump = useRef(false);

  // On first load of a live session, jump to the tail so follow starts pinned.
  useEffect(() => {
    if (!live || didInitialJump.current || stepCount === 0) return;
    didInitialJump.current = true;
    window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [live, stepCount]);

  useEffect(() => {
    const onScroll = () => {
      const distance =
        document.documentElement.scrollHeight -
        window.scrollY -
        window.innerHeight;
      setPinned(distance < BOTTOM_THRESHOLD_PX);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!live) return;
    if (pinned) {
      lastSeenCount.current = stepCount;
      setMissed(0);
      window.scrollTo({ top: document.documentElement.scrollHeight });
    } else {
      setMissed(Math.max(0, stepCount - lastSeenCount.current));
    }
  }, [stepCount, pinned, live]);

  if (!live) return null;

  const resume = () => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "smooth",
    });
  };

  return (
    <div className="fixed bottom-4 right-4 z-40">
      {pinned ? (
        <div className="flex items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1.5 font-mono text-[11px] text-muted-foreground shadow-md backdrop-blur">
          <ArrowDownToLine className="h-3 w-3 text-green-500" />
          following
        </div>
      ) : (
        <button
          type="button"
          onClick={resume}
          className="flex items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1.5 font-mono text-[11px] shadow-md backdrop-blur hover:bg-accent"
        >
          <Pause className="h-3 w-3 text-amber-500" />
          paused{missed > 0 && <> — {missed} new</>} · resume
        </button>
      )}
    </div>
  );
}

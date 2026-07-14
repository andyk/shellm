import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";

import { IdentityTabs } from "~/components/identity-tabs";
import {
  StartStopButtons,
  useControlsEnabled,
} from "~/components/thinker-controls";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { LoadingDots } from "~/components/ui/loading-dots";
import {
  fetchChat,
  fetchIdentityStatus,
  fetchThinkers,
  sendChat,
} from "~/lib/api";
import type { ChatMessage } from "~/lib/types";
import { cn } from "~/lib/utils";

export function meta() {
  return [{ title: "shellm · chat" }];
}

const MY_NAME_KEY = "shellm-chat-from";

function myNameDefault(): string {
  if (typeof window === "undefined") return "you";
  return window.localStorage.getItem(MY_NAME_KEY) || "you";
}

function messageTime(ts: string | null): string {
  if (!ts) return "";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Bubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-lg px-3 py-2",
          mine ? "bg-primary text-primary-foreground" : "border bg-card"
        )}
      >
        <div
          className={cn(
            "mb-0.5 flex items-baseline gap-2 font-mono text-[10px]",
            mine ? "text-primary-foreground/70" : "text-muted-foreground"
          )}
        >
          <span>
            {message.from} → {message.to || "?"}
          </span>
          <span>{messageTime(message.ts)}</span>
        </div>
        {message.filename && (
          <div className="mb-1 font-mono text-[10px] opacity-70">
            📎 {message.filename}
          </div>
        )}
        <div className="whitespace-pre-wrap break-words text-sm">
          {message.content}
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { identityId = "" } = useParams();
  const controlsEnabled = useControlsEnabled();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [myName, setMyName] = useState(myNameDefault);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: status } = useQuery({
    queryKey: ["status", identityId],
    queryFn: () => fetchIdentityStatus(identityId),
    refetchInterval: 2000,
  });
  const live = status?.live ?? false;

  const { data: chat, isLoading } = useQuery({
    queryKey: ["chat", identityId],
    queryFn: () => fetchChat(identityId),
    refetchInterval: 2000,
  });

  const { data: thinkerStatus } = useQuery({
    queryKey: ["thinkers", identityId],
    queryFn: () => fetchThinkers(identityId),
    refetchInterval: 5000,
  });
  const dispatcherRunning = thinkerStatus?.dispatcher.running ?? true;

  const messages = chat?.messages ?? [];
  const messageCount = messages.length;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messageCount]);

  const sendMutation = useMutation({
    mutationFn: (content: string) => sendChat(identityId, content, myName),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["chat", identityId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const identityName = chat?.identity.name ?? identityId.split("~").pop();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4">
      <IdentityTabs identityId={identityId} live={live} active="chat" />

      {controlsEnabled && !dispatcherRunning && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <span>
            Thinkers are stopped — {identityName} won't see or answer messages.
          </span>
          <div className="ml-auto">
            <StartStopButtons identityId={identityId} names={[]} running={false} />
          </div>
        </div>
      )}

      <div className="flex min-h-[40vh] flex-col gap-2 overflow-y-auto rounded-lg border bg-background p-4 max-h-[65vh]">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <LoadingDots />
          </div>
        ) : messages.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No messages yet. Say hello.
          </div>
        ) : (
          messages.map((message, idx) => (
            <Bubble
              key={message.step_id ?? idx}
              message={message}
              mine={message.from === myName}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {controlsEnabled && (
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const content = draft.trim();
            if (content && !sendMutation.isPending) sendMutation.mutate(content);
          }}
        >
          <Input
            value={myName}
            onChange={(event) => {
              setMyName(event.target.value);
              window.localStorage.setItem(MY_NAME_KEY, event.target.value);
            }}
            title="Your name (the from field on messages)"
            className="h-9 w-24 font-mono text-xs"
          />
          <Input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Message ${identityName}…`}
            className="h-9 flex-1"
          />
          <Button
            type="submit"
            size="sm"
            disabled={sendMutation.isPending || !draft.trim()}
          >
            <SendHorizontal className="size-3.5" />
            Send
          </Button>
        </form>
      )}
    </div>
  );
}

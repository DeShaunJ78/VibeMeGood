import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Send, Trash2 } from "lucide-react";
import { useSharkChat } from "@/contexts/SharkChatContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 pr-16">
      <div className="shrink-0 w-7 h-7 rounded-full bg-cyan-900/50 border border-cyan-700/40 flex items-center justify-center text-sm select-none">
        🦈
      </div>
      <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3">
        <div className="flex gap-1 items-center h-4">
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  return (
    <div className={cn("flex items-start gap-3", isUser ? "flex-row-reverse pl-16" : "pr-16")}>
      {!isUser && (
        <div className="shrink-0 w-7 h-7 rounded-full bg-cyan-900/50 border border-cyan-700/40 flex items-center justify-center text-sm select-none">
          🦈
        </div>
      )}
      <div
        className={cn(
          "rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-slate-800 border border-slate-700 text-slate-100",
        )}
      >
        {content}
      </div>
    </div>
  );
}

export default function SharkChat() {
  const { messages, draftInput, setDraftInput, sendMessage, clearChat, isLoading } = useSharkChat();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // Auto-scroll to bottom on new messages or loading state change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (draftInput.trim() && !isLoading) {
        sendMessage(draftInput);
      }
    }
  }

  function handleSend() {
    if (draftInput.trim() && !isLoading) {
      sendMessage(draftInput);
    }
  }

  function handleClearConfirm() {
    clearChat();
    setConfirmClear(false);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-4 mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-2xl select-none">🦈</span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Personal Shark</h1>
            <p className="text-xs text-muted-foreground font-mono">PrizePicks pick'em analytics assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {confirmClear ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground font-mono text-xs">Clear this conversation?</span>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs font-mono"
                onClick={handleClearConfirm}
              >
                Clear
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs font-mono"
                onClick={() => setConfirmClear(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setConfirmClear(true)}
              title="Clear conversation"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Paper Trade Mode banner */}
      <div className="shrink-0 mb-4 px-3 py-2 rounded-md bg-amber-950/40 border border-amber-700/40 flex items-center gap-2">
        <span className="text-amber-400 text-xs font-mono font-bold uppercase tracking-widest">
          📄 Paper Trade Mode Active
        </span>
        <span className="text-amber-200/60 text-xs font-mono">
          — No real-money recommendations. Build evidence first.
        </span>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
        {messages.map(msg => (
          <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
        ))}
        {isLoading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 mt-4 flex gap-2 items-end">
        <Textarea
          ref={textareaRef}
          value={draftInput}
          onChange={e => setDraftInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about break-even rates, entry construction, variance signals…"
          rows={2}
          className="resize-none bg-slate-900 border-slate-700 focus:border-primary font-mono text-sm min-h-[56px] max-h-40"
          disabled={isLoading}
          autoFocus
        />
        <Button
          onClick={handleSend}
          disabled={!draftInput.trim() || isLoading}
          className="h-[56px] w-12 p-0 shrink-0"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
      <p className="text-[10px] text-slate-600 font-mono mt-1.5 shrink-0">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
}

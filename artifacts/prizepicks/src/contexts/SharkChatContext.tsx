import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface SharkChatContextValue {
  messages: ChatMessage[];
  draftInput: string;
  setDraftInput: (val: string) => void;
  sendMessage: (text: string) => void;
  clearChat: () => void;
  isLoading: boolean;
}

const STORAGE_MESSAGES = "vmg_shark_messages";
const STORAGE_DRAFT    = "vmg_shark_draft_input";

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Welcome. I'm your Personal Shark for VibeMeGood.\n\n" +
    "Ask me anything about PrizePicks pick'em analytics, entry construction, break-even rates, payout shifts, variance signals, or the daily workflow.\n\n" +
    "Paper Trade Mode is active — no real-money recommendations.",
  timestamp: 0,
};

function loadMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_MESSAGES);
    if (raw) {
      const parsed = JSON.parse(raw) as ChatMessage[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [WELCOME_MESSAGE];
}

function saveMessages(msgs: ChatMessage[]) {
  try { localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(msgs)); } catch {}
}

function loadDraft(): string {
  try { return localStorage.getItem(STORAGE_DRAFT) ?? ""; } catch { return ""; }
}

function saveDraft(val: string) {
  try { localStorage.setItem(STORAGE_DRAFT, val); } catch {}
}

const SharkChatContext = createContext<SharkChatContextValue | null>(null);

export function SharkChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [draftInput, _setDraftInput] = useState<string>(loadDraft);
  const [isLoading, setIsLoading] = useState(false);
  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

  // Keep a ref so sendMessage always has the latest messages for history
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;

  const setDraftInput = useCallback((val: string) => {
    _setDraftInput(val);
    saveDraft(val);
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };

    const nextMessages = [...messagesRef.current, userMsg];
    setMessages(nextMessages);
    saveMessages(nextMessages);
    setDraftInput("");
    setIsLoading(true);

    // Build conversation history (exclude welcome, exclude new user msg)
    const history = nextMessages
      .filter(m => m.id !== "welcome")
      .slice(0, -1) // exclude the just-added user message (backend appends it)
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const r = await fetch(`${base}/api/shark/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          app: "vibemegood",
          conversationHistory: history,
        }),
      });

      const data = await r.json() as { reply?: string; error?: string };
      const reply = data.reply ?? (data.error ? `Error: ${data.error}` : "Sorry, something went wrong.");

      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: reply,
        timestamp: Date.now(),
      };

      const withReply = [...nextMessages, assistantMsg];
      setMessages(withReply);
      saveMessages(withReply);
    } catch {
      const errMsg: ChatMessage = {
        id: `e-${Date.now()}`,
        role: "assistant",
        content: "Network error — couldn't reach the Shark. Check API server status.",
        timestamp: Date.now(),
      };
      const withErr = [...nextMessages, errMsg];
      setMessages(withErr);
      saveMessages(withErr);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, base, setDraftInput]);

  const clearChat = useCallback(() => {
    const fresh = [WELCOME_MESSAGE];
    setMessages(fresh);
    saveMessages(fresh);
  }, []);

  return (
    <SharkChatContext.Provider value={{ messages, draftInput, setDraftInput, sendMessage, clearChat, isLoading }}>
      {children}
    </SharkChatContext.Provider>
  );
}

export function useSharkChat() {
  const ctx = useContext(SharkChatContext);
  if (!ctx) throw new Error("useSharkChat must be used inside SharkChatProvider");
  return ctx;
}

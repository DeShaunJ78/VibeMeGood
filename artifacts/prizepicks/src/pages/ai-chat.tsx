import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Send, Plus, Trash2, MessageSquare, Bot } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Conversation { id: number; title: string; createdAt: string; }
interface Message { id: number; conversationId: number; role: string; content: string; createdAt: string; }

const BASE = "/api";

async function apiGet(path: string) {
  const r = await fetch(`${BASE}${path}`);
  return r.json();
}
async function apiPost(path: string, body: object) {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
async function apiDelete(path: string) {
  await fetch(`${BASE}${path}`, { method: "DELETE" });
}

export default function AiChat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiGet("/anthropic/conversations").then(data => {
      setConversations(Array.isArray(data) ? data : []);
      setLoadingConvs(false);
    }).catch(() => setLoadingConvs(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadConversation(id: number) {
    setActiveId(id);
    setMessages([]);
    setLoadingMsgs(true);
    const data = await apiGet(`/anthropic/conversations/${id}/messages`);
    setMessages(Array.isArray(data) ? data : []);
    setLoadingMsgs(false);
  }

  async function newConversation() {
    const conv = await apiPost("/anthropic/conversations", { title: "New analysis" });
    setConversations(prev => [conv, ...prev]);
    setActiveId(conv.id);
    setMessages([]);
  }

  async function deleteConversation(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    await apiDelete(`/anthropic/conversations/${id}`);
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeId === id) { setActiveId(null); setMessages([]); }
  }

  async function sendMessage() {
    if (!input.trim() || !activeId || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);
    const optimistic: Message = { id: Date.now(), conversationId: activeId, role: "user", content: text, createdAt: new Date().toISOString() };
    setMessages(prev => [...prev, optimistic]);
    try {
      const data = await apiPost(`/anthropic/conversations/${activeId}/messages`, { content: text });
      setMessages(prev => [
        ...prev.filter(m => m.id !== optimistic.id),
        data.userMessage,
        data.assistantMessage,
      ]);
      setConversations(prev => prev.map(c => c.id === activeId ? { ...c, title: text.slice(0, 40) } : c));
    } catch {
      setMessages(prev => [...prev, { id: Date.now(), conversationId: activeId, role: "assistant", content: "Error: could not get a response. Please try again.", createdAt: new Date().toISOString() }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-border pb-4 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">AI Analyst</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">Claude claude-opus-4-5</span>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-[240px_1fr] gap-0 min-h-0 border border-slate-800 rounded-lg overflow-hidden mt-2">
        {/* Sidebar */}
        <div className="bg-slate-950 border-r border-slate-800 flex flex-col">
          <div className="p-3 border-b border-slate-800 shrink-0">
            <Button onClick={newConversation} className="w-full font-mono text-xs bg-slate-800 hover:bg-slate-700 text-foreground" variant="outline">
              <Plus className="w-3.5 h-3.5 mr-2" /> New Conversation
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingConvs ? (
              <div className="p-3 space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 bg-slate-800" />)}
              </div>
            ) : conversations.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground font-mono">No conversations yet</div>
            ) : (
              conversations.map(conv => (
                <div
                  key={conv.id}
                  onClick={() => loadConversation(conv.id)}
                  className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer border-b border-slate-800/50 transition-colors ${activeId === conv.id ? "bg-slate-800/70" : "hover:bg-slate-900"}`}
                >
                  <MessageSquare className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{conv.title}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{formatDistanceToNow(new Date(conv.createdAt), { addSuffix: true })}</div>
                  </div>
                  <button
                    onClick={(e) => deleteConversation(conv.id, e)}
                    className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-rose-400 shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex flex-col bg-slate-900 min-h-0">
          {!activeId ? (
            <div className="flex-1 flex items-center justify-center text-center p-8">
              <div>
                <Bot className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                <p className="text-sm font-mono text-muted-foreground">Select a conversation or start a new one.</p>
                <p className="text-xs text-slate-500 font-mono mt-2">Ask about props, line value, injury impact, correlation risk, or anything analytics.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {loadingMsgs ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16 bg-slate-800 w-3/4" />
                    <Skeleton className="h-24 bg-slate-800 w-4/5 ml-auto" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <Bot className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground font-mono">Ask anything about today's slate.</p>
                    </div>
                  </div>
                ) : (
                  messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-lg px-4 py-3 text-sm font-mono leading-relaxed whitespace-pre-wrap ${
                        msg.role === "user"
                          ? "bg-primary/20 border border-primary/30 text-foreground"
                          : "bg-slate-800 border border-slate-700 text-slate-200"
                      }`}>
                        {msg.role === "assistant" && (
                          <div className="flex items-center gap-1.5 mb-2 text-[10px] text-muted-foreground">
                            <Bot className="w-3 h-3" /> Claude
                          </div>
                        )}
                        {msg.content}
                      </div>
                    </div>
                  ))
                )}
                {sending && (
                  <div className="flex justify-start">
                    <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3">
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1"><Bot className="w-3 h-3" /> Claude</div>
                      <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></div>
                        <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
                        <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
              <div className="border-t border-slate-800 p-3 shrink-0">
                <div className="flex gap-2">
                  <Input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                    placeholder="Ask about props, edges, injuries, correlations..."
                    className="flex-1 bg-slate-950 border-slate-700 font-mono text-sm"
                    disabled={sending}
                  />
                  <Button onClick={sendMessage} disabled={sending || !input.trim()} className="shrink-0 bg-primary hover:bg-primary/90">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

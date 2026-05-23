import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import SlateBoard from "@/pages/slate-board";
import Injuries from "@/pages/injuries";
import EntryBuilder from "@/pages/entry-builder";
import Journal from "@/pages/journal";
import Review from "@/pages/review";
import Settings from "@/pages/settings";
import AiChat from "@/pages/ai-chat";
import Streaks from "@/pages/streaks";
import Clv from "@/pages/clv";
import Matchup from "@/pages/matchup";
import Guide from "@/pages/guide";
import { EntryProvider } from "@/lib/entry-context";

const queryClient = new QueryClient();

export type SyncStatus = Record<string, "running" | "success" | "error">;
export type SSENotification = { type: "goblin" | "move"; playerName?: string; stat?: string; line?: number; from?: number; to?: number; sport?: string; timestamp: string };

function SSEListener() {
  const qc = useQueryClient();

  useEffect(() => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const es = new EventSource(`${base}/api/events`);

    es.addEventListener("sync_status", (e) => {
      const data = JSON.parse(e.data) as { job: string; status: string };
      if (data.status === "success") {
        qc.invalidateQueries();
      }
    });

    es.addEventListener("heartbeat", () => { /* keep-alive */ });

    return () => es.close();
  }, [qc]);

  return null;
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/slate" component={SlateBoard} />
        <Route path="/injuries" component={Injuries} />
        <Route path="/entry-builder" component={EntryBuilder} />
        <Route path="/journal" component={Journal} />
        <Route path="/review" component={Review} />
        <Route path="/ai-chat" component={AiChat} />
        <Route path="/streaks" component={Streaks} />
        <Route path="/clv" component={Clv} />
        <Route path="/matchup" component={Matchup} />
        <Route path="/guide" component={Guide} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <EntryProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <SSEListener />
            <Router />
          </WouterRouter>
        </EntryProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

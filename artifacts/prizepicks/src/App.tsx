import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
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
import LineupFactory from "@/pages/lineup-factory";
import StabilityRadar from "@/pages/variance/stability";
import FatigueTracker from "@/pages/variance/fatigue";
import EnvironmentBoard from "@/pages/variance/environment";
import UsageSignals from "@/pages/variance/usage";
import ExperimentalLab from "@/pages/variance/lab";
import SystemHealth from "@/pages/system-health";
import SharkChat from "@/pages/shark-chat";
import { EntryProvider } from "@/lib/entry-context";
import { SharkChatProvider } from "@/contexts/SharkChatContext";

const queryClient = new QueryClient();

export type SyncStatus = Record<string, "running" | "success" | "error">;
export type SSENotification = { type: "goblin" | "move"; playerName?: string; stat?: string; line?: number; from?: number; to?: number; sport?: string; timestamp: string };

function SSEListener() {
  const qc = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const es = new EventSource(`${base}/api/events`);

    es.addEventListener("sync_status", (e) => {
      const data = JSON.parse(e.data) as { job: string; status: string };
      if (data.status === "success") {
        qc.invalidateQueries();
      }
    });

    es.addEventListener("tilt_warning", (e) => {
      const data = JSON.parse(e.data) as { message: string };
      toast({
        title: "⚠ Tilt Warning",
        description: data.message,
        variant: "destructive",
        duration: 10000,
      });
    });

    es.addEventListener("stake_escalation", (e) => {
      const data = JSON.parse(e.data) as { message: string };
      toast({
        title: "⚠ Stake Escalation",
        description: data.message,
        variant: "destructive",
        duration: 10000,
      });
    });

    es.addEventListener("injury_alert", (e) => {
      const data = JSON.parse(e.data) as { playerName: string; status: string; message: string; severity: string };
      toast({
        title: `🏥 ${data.playerName} — ${data.status}`,
        description: data.message,
        variant: data.severity === "critical" ? "destructive" : "default",
        duration: 12000,
      });
      qc.invalidateQueries({ queryKey: ["injuries"] });
    });

    es.addEventListener("heartbeat", () => { /* keep-alive */ });

    return () => es.close();
  }, [qc, toast]);

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
        <Route path="/lineup-factory" component={LineupFactory} />
        <Route path="/guide" component={Guide} />
        <Route path="/settings" component={Settings} />
        <Route path="/variance/stability" component={StabilityRadar} />
        <Route path="/variance/fatigue" component={FatigueTracker} />
        <Route path="/variance/environment" component={EnvironmentBoard} />
        <Route path="/variance/usage" component={UsageSignals} />
        <Route path="/variance/lab" component={ExperimentalLab} />
        <Route path="/health" component={SystemHealth} />
        <Route path="/shark" component={SharkChat} />
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
          <SharkChatProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <SSEListener />
            <Router />
          </WouterRouter>
          </SharkChatProvider>
        </EntryProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

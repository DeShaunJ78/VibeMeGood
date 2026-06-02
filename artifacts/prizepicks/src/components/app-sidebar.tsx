import { Link, useLocation } from "wouter";
import {
  Activity,
  LayoutDashboard,
  TableProperties,
  Settings as SettingsIcon,
  BookOpen,
  LineChart,
  ListPlus,
  Bot,
  Flame,
  TrendingUp,
  Swords,
  HelpCircle,
  Shield,
  Battery,
  Wind,
  FlaskConical,
  Factory,
  Zap,
  MessageSquare,
  Crosshair,
  Microscope,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useEntry } from "@/lib/entry-context";
import { useUserSettings } from "@/hooks/use-user-settings";
import { useGetDataHealth, getGetDataHealthQueryKey } from "@workspace/api-client-react";

const NAV_ITEMS = [
  { title: "Command Center", url: "/", icon: LayoutDashboard },
  { title: "Slates", url: "/slate", icon: TableProperties },
  { title: "Injuries & News", url: "/injuries", icon: Activity },
  { title: "Entry Builder", url: "/entry-builder", icon: ListPlus },
  { title: "Journal", url: "/journal", icon: BookOpen },
  { title: "Review", url: "/review", icon: LineChart },
  { title: "AI Analyst", url: "/ai-chat", icon: Bot },
  { title: "Lineup Factory", url: "/lineup-factory", icon: Factory },
];

const INTEL_ITEMS = [
  { title: "Streak Tracker", url: "/streaks", icon: Flame },
  { title: "CLV Tracker", url: "/clv", icon: TrendingUp },
  { title: "Matchup Analysis", url: "/matchup", icon: Swords },
  { title: "Model Calibration", url: "/calibration", icon: Crosshair },
  { title: "Model Audit", url: "/audit", icon: Microscope },
  { title: "User Guide", url: "/guide", icon: HelpCircle },
];

const BOTTOM_ITEMS = [
  { title: "Shark Chat", url: "/shark", icon: MessageSquare },
  { title: "Settings", url: "/settings", icon: SettingsIcon },
];

const VARIANCE_ITEMS = [
  { title: "Stability Radar",  url: "/variance/stability",    icon: Shield },
  { title: "Fatigue Tracker",  url: "/variance/fatigue",      icon: Battery },
  { title: "Environment Board",url: "/variance/environment",  icon: Wind },
  { title: "Usage Signals",    url: "/variance/usage",        icon: Activity },
  { title: "Experimental Lab", url: "/variance/lab",          icon: FlaskConical, isLab: true },
];

const PP_STALE_HOURS = 4; // show warning after this many hours without a sync

export function AppSidebar() {
  const [location] = useLocation();
  const { state, setOpenMobile } = useSidebar();
  const isCollapsed = state === "collapsed";
  const closeOnMobile = () => setOpenMobile(false);
  const { picks } = useEntry();
  const { data: userSettings } = useUserSettings();

  // Poll data health every 5 min to detect stale PP lines
  const { data: healthData } = useGetDataHealth({
    query: {
      queryKey: getGetDataHealthQueryKey(),
      refetchInterval: 5 * 60 * 1000,
      staleTime: 4 * 60 * 1000,
    },
  });
  const ppProvider = (healthData?.providers as any[])?.find(
    (p: any) => p.provider === "prizepicks",
  );
  const ppAgeHours: number = ppProvider?.boardAgeHours ?? 0;
  const ppStale = ppAgeHours >= PP_STALE_HOURS;
  const ppAgeLabel = ppAgeHours < 1
    ? "<1h"
    : `${Math.floor(ppAgeHours)}h`;

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="border-b border-border/50 pb-4 pt-4 px-4">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="shrink-0">
            <svg width="30" height="30" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="180" height="180" rx="36" fill="#0f172a"/>
              <rect width="180" height="180" rx="36" fill="none" stroke="#6d28d9" strokeWidth="6" strokeOpacity="0.4"/>
              <defs>
                <linearGradient id="sb-grad" x1="26" y1="145" x2="156" y2="34" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#6d28d9"/>
                  <stop offset="100%" stopColor="#10b981"/>
                </linearGradient>
              </defs>
              <polyline
                points="26,145 64,108 96,124 130,68 156,34"
                stroke="url(#sb-grad)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" fill="none"
              />
              <circle cx="156" cy="34" r="14" fill="#10b981" fillOpacity="0.25"/>
              <circle cx="156" cy="34" r="8" fill="#10b981"/>
            </svg>
          </div>
          {!isCollapsed && (
            <div className="flex flex-col truncate">
              <span className="font-bold text-sm leading-tight text-foreground truncate">PrizePicks</span>
              <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest truncate">Workstation</span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="pb-0">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location === "/health"}
                  tooltip="System Status"
                  className={cn(
                    "transition-colors font-mono",
                    location === "/health"
                      ? "bg-yellow-950/60 text-yellow-300 border border-yellow-700/50 font-medium"
                      : "text-yellow-400/80 hover:text-yellow-300 hover:bg-yellow-950/30 border border-transparent"
                  )}
                >
                  <Link href="/health" onClick={closeOnMobile}>
                    <Zap size={14} />
                    <span>⚡ System Status</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          {!isCollapsed && (
            <SidebarGroupLabel className="text-xs uppercase font-mono text-muted-foreground tracking-wider mb-2">
              Analytics
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const isActive = location === item.url;
                const isEntryBuilder = item.url === "/entry-builder";
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                      className={cn(
                        "transition-colors relative",
                        isActive ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-slate-800/50"
                      )}
                    >
                      <Link href={item.url} onClick={closeOnMobile} data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                        <item.icon />
                        <span>{item.title}</span>
                        {isEntryBuilder && picks.length > 0 && (
                          <span className="ml-auto bg-primary text-primary-foreground text-[10px] font-bold font-mono rounded-full w-4 h-4 flex items-center justify-center shrink-0">
                            {picks.length}
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          {!isCollapsed && (
            <SidebarGroupLabel className="text-xs uppercase font-mono text-muted-foreground tracking-wider mb-2">
              Intelligence
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {INTEL_ITEMS.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                      className={cn(
                        "transition-colors",
                        isActive ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-slate-800/50"
                      )}
                    >
                      <Link href={item.url} onClick={closeOnMobile} data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {userSettings?.varianceIntelEnabled && (
          <SidebarGroup>
            {!isCollapsed && (
              <SidebarGroupLabel className="text-xs uppercase font-mono text-muted-foreground tracking-wider mb-2">
                Variance Intel
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {VARIANCE_ITEMS.filter(item => !item.isLab || userSettings.experimentalLabEnabled).map(item => {
                  const isActive = location === item.url;
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.title}
                        className={cn(
                          "transition-colors",
                          isActive ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-slate-800/50"
                        )}
                      >
                        <Link href={item.url} onClick={closeOnMobile}>
                          <item.icon className="w-4 h-4" />
                          <span>{item.title}</span>
                          {item.isLab && !isCollapsed && (
                            <span className="ml-auto text-[9px] font-mono bg-amber-900/40 text-amber-400 border border-amber-700/50 px-1 py-0.5 rounded">LAB</span>
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              {BOTTOM_ITEMS.map((item) => {
                const isActive = location === item.url;
                const isSettings = item.url === "/settings";
                const showStaleBadge = isSettings && ppStale;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={isSettings && ppStale ? `Lines stale — ${ppAgeLabel} since last sync` : item.title}
                      className={cn(
                        "transition-colors",
                        isActive ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-slate-800/50"
                      )}
                    >
                      <Link href={item.url} onClick={closeOnMobile} data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                        <div className="relative shrink-0">
                          <item.icon />
                          {showStaleBadge && (
                            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                          )}
                        </div>
                        <span>{item.title}</span>
                        {showStaleBadge && !isCollapsed && (
                          <span className="ml-auto font-mono text-[10px] bg-red-500/20 text-red-400 border border-red-500/40 px-1.5 py-0.5 rounded">
                            {ppAgeLabel} stale
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

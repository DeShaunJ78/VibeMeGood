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

const NAV_ITEMS = [
  { title: "Command Center", url: "/", icon: LayoutDashboard },
  { title: "Slate Board", url: "/slate", icon: TableProperties },
  { title: "Injuries & News", url: "/injuries", icon: Activity },
  { title: "Entry Builder", url: "/entry-builder", icon: ListPlus },
  { title: "Journal", url: "/journal", icon: BookOpen },
  { title: "Review", url: "/review", icon: LineChart },
  { title: "AI Analyst", url: "/ai-chat", icon: Bot },
  { title: "Settings", url: "/settings", icon: SettingsIcon },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { picks } = useEntry();

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="border-b border-border/50 pb-4 pt-4 px-4">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="bg-primary/20 p-1 rounded border border-primary/30 shrink-0 text-primary">
            <Activity size={20} />
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
                      <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
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
      </SidebarContent>
    </Sidebar>
  );
}

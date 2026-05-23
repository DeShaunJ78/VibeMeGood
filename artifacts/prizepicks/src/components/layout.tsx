import { PropsWithChildren } from "react";
import { AppSidebar } from "./app-sidebar";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Menu, Activity } from "lucide-react";

function MobileHeader() {
  const { toggleSidebar, isMobile } = useSidebar();
  if (!isMobile) return null;
  return (
    <header className="shrink-0 flex items-center gap-3 px-4 h-12 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:hidden">
      <Button
        variant="ghost"
        size="icon"
        className="w-8 h-8 text-muted-foreground hover:text-foreground"
        onClick={toggleSidebar}
        aria-label="Open navigation"
      >
        <Menu className="w-5 h-5" />
      </Button>
      <div className="flex items-center gap-2">
        <div className="bg-primary/20 p-0.5 rounded border border-primary/30 text-primary">
          <Activity size={14} />
        </div>
        <span className="font-bold text-sm text-foreground">PrizePicks</span>
        <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">Workstation</span>
      </div>
    </header>
  );
}

export function Layout({ children }: PropsWithChildren) {
  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex min-h-[100dvh] w-full bg-background text-foreground font-sans">
        <AppSidebar />
        <main className="flex-1 flex flex-col h-[100dvh] overflow-hidden">
          <MobileHeader />
          <div className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

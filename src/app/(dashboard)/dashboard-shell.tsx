"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopNav } from "@/components/layout/top-nav";
import { ContextualSubmenu } from "@/components/layout/contextual-submenu";
import { findActiveArea } from "@/lib/navigation/nav-areas";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { cn } from "@/lib/utils";

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const activeArea = findActiveArea(pathname);
  const isInbox = pathname === "/inbox" || pathname.startsWith("/inbox/");
  const isCanvas = pathname.startsWith("/flows/");
  const fullBleed = isInbox || isCanvas;

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <PresenceHeartbeat />
      <AppSidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="lg:hidden">
          <TopNav />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeArea?.submenu?.length && !isInbox ? (
            <div className="lg:hidden">
              <ContextualSubmenu area={activeArea} />
            </div>
          ) : null}

          <main
            className={cn(
              "min-h-0 flex-1 bg-background",
              fullBleed ? "overflow-hidden p-0" : "overflow-y-auto p-4 sm:p-6 lg:p-7",
              isInbox && "wacrm-inbox-shell",
              !fullBleed && "wacrm-workspace-shell"
            )}
          >
            {fullBleed ? children : <div className="wacrm-page">{children}</div>}
          </main>
        </div>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}

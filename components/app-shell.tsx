"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, AlertCircle, Settings, Plus, Link2, BarChart2, Menu, X, Play, RotateCcw, Loader2, LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useData } from "@/lib/data-context";
import { signOut, useSession } from "next-auth/react";
import { NewRunModal } from "@/components/new-run-modal/NewRunModal";



interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isResettingMatches, setIsResettingMatches] = useState(false);
  const { matches, exceptionCount, isNewRunModalOpen, setIsNewRunModalOpen } = useData();

  const handleResetMatches = async () => {
    setIsResettingMatches(true);
    try {
      const response = await fetch('/api/recon/reset-matches', { method: 'POST' });
      if (!response.ok) {
        throw new Error("Failed to reset matches");
      }
      toast.success("Matches have been reset!");
      // Force a full reload to clear all cached client state
      window.location.href = pathname === "/dashboard" ? "/dashboard" : pathname;
    } catch (e: any) {
      toast.error(e.message || "An error occurred");
      setIsResettingMatches(false);
    }
  };

  const reconciledPercent = matches.length > 0 
    ? Math.round((matches.filter(m => m.matchType === "exact" || m.status === "approved").length / matches.length) * 100)
    : 0;

  // Close mobile menu on route change
  // In a real app we'd use useEffect, but doing it in click handlers for simplicity



  const navItems = [
    { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard", active: pathname === "/dashboard" },
    { href: "/connect", icon: Link2, label: "Integrations", active: pathname === "/connect" },
    { href: "/exceptions", icon: AlertCircle, label: "Exceptions", active: pathname === "/exceptions", badge: exceptionCount > 0 ? exceptionCount.toString() : undefined, badgeColor: "bg-red-100 text-red-600" },
    { href: "/reports", icon: BarChart2, label: "Reports", active: pathname === "/reports" },
    { href: "/settings", icon: Settings, label: "Settings", active: pathname === "/settings" },
  ];

  // Only truly public / standalone pages skip the app shell.
  // /connect is a regular app page — onboarded users need the sidebar there.
  const isPublicPath = pathname === "/" || pathname === "/sign-in" || pathname === "/sign-up" || pathname === "/onboarding";

  if (isPublicPath) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex flex-col bg-white text-slate-900 font-sans select-none">
      {/* Top Nav */}
      <header className="h-16 border-b border-slate-200 flex items-center justify-between px-4 sm:px-6 bg-white shrink-0 z-20">
        <div className="flex items-center gap-4 sm:gap-8">
          <button 
            className="md:hidden p-1 -ml-1 text-slate-500 hover:bg-slate-100 rounded-md"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
          
          <div className="flex items-center gap-2">
            <Link href="/dashboard" className="font-brand text-2xl sm:text-3xl tracking-tight text-slate-900 flex items-baseline">
              Recon<span className="italic text-accent-ink font-brand mr-0.5">F</span>low
            </Link>
          </div>
        </div>
        
        <div className="flex items-center gap-3 sm:gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetMatches}
            disabled={isResettingMatches}
            className="h-9 hidden sm:flex items-center gap-1.5 border-slate-300 text-slate-700 hover:bg-slate-100"
            title="Reset existing matches and start fresh"
          >
            {isResettingMatches ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            Reset Matches
          </Button>
          <Button 
            size="sm" 
            className="bg-slate-900 text-white px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium hover:bg-slate-800 h-9 hidden sm:flex items-center gap-1.5"
            onClick={() => setIsNewRunModalOpen(true)}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            New run
          </Button>
          
          <Button 
            variant="outline"
            size="icon" 
            className="w-8 h-8 rounded-md sm:hidden text-slate-700"
            onClick={handleResetMatches}
            disabled={isResettingMatches}
          >
            {isResettingMatches ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          </Button>
          <Button 
            size="icon" 
            className="bg-slate-900 text-white w-8 h-8 rounded-md sm:hidden"
            onClick={() => setIsNewRunModalOpen(true)}
          >
            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
          </Button>
          
          <Popover>
            <PopoverTrigger className="flex items-center justify-center rounded-full hover:ring-2 hover:ring-slate-200 transition-all focus:outline-none">
              <Avatar className="h-8 w-8 sm:h-9 sm:w-9 border border-slate-200 shadow-sm">
                {session?.user?.image ? (
                  <AvatarImage src={session.user.image} alt={session.user.name || "User"} />
                ) : (
                  <AvatarFallback className="bg-slate-100 text-slate-700 font-medium text-xs">
                    {session?.user?.name ? session.user.name.charAt(0).toUpperCase() : "U"}
                  </AvatarFallback>
                )}
              </Avatar>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2 bg-white rounded-xl shadow-lg border border-slate-200" sideOffset={8}>
              <div className="flex flex-col space-y-1 p-3 border-b border-slate-100 mb-2">
                <p className="text-sm font-semibold text-slate-900 truncate">{session?.user?.name || "User"}</p>
                <p className="text-xs text-slate-500 truncate">{session?.user?.email || "No email"}</p>
              </div>
              <Link href="/settings" className="flex items-center w-full px-3 py-2 text-sm text-slate-700 rounded-md hover:bg-slate-50 transition-colors">
                <Settings className="mr-2 h-4 w-4 text-slate-500" />
                Settings
              </Link>
              <a href="mailto:adityajain2903@gmail.com?subject=ReconFlow%20Support%20Request" className="flex items-center w-full px-3 py-2 text-sm text-slate-700 rounded-md hover:bg-slate-50 transition-colors">
                <AlertCircle className="mr-2 h-4 w-4 text-slate-500" />
                Support
              </a>
              <button 
                onClick={() => signOut({ callbackUrl: "/sign-in" })}
                className="flex items-center w-full px-3 py-2 text-sm text-red-600 rounded-md hover:bg-red-50 transition-colors mt-1"
              >
                <LogOut className="mr-2 h-4 w-4 text-red-500" />
                Sign out
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </header>

      {/* Main Content & Sidebar Container */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Mobile Sidebar Overlay */}
        {mobileMenuOpen && (
          <div 
            className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm z-10 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Left Sidebar */}
        <aside className={cn(
          "absolute md:static top-0 left-0 h-full w-64 md:w-60 border-r border-slate-200 bg-slate-50/80 backdrop-blur-md md:bg-slate-50/50 flex flex-col p-4 shrink-0 transition-transform duration-200 ease-in-out z-20 relative",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}>
          <nav className="flex flex-col gap-1.5 flex-1 pb-[84px]">
            {navItems.map((item) => (
              <NavItem 
                key={item.href}
                {...item} 
                onClick={() => setMobileMenuOpen(false)}
              />
            ))}
          </nav>
          
          {matches.length > 0 && (
            <Link href="/reports" className="block absolute bottom-0 left-0 right-0 p-3 transition-colors hover:opacity-95" style={{ backgroundColor: "hsl(222 47% 11%)" }}>
              <div className="group relative">
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-slate-900 border border-slate-800 text-[11px] text-white rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                  You&apos;ve reconciled {reconciledPercent}% of this month&apos;s transactions
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  PRO PLAN
                </div>
                <div 
                  className="font-medium tracking-tight mb-2 text-white/95" 
                  style={{ fontSize: "13px", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {reconciledPercent}% Reconciliation
                </div>
                <div className="w-full h-1 rounded-[2px] overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}>
                  <div 
                    className="h-full rounded-[2px]" 
                    style={{ 
                      width: `${reconciledPercent}%`,
                      backgroundImage: "linear-gradient(to right, #22c55e, #16a34a)" 
                    }} 
                  />
                </div>
              </div>
            </Link>
          )}
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col bg-slate-50/30 overflow-hidden overflow-y-auto w-full relative">
          {children}
        </main>
      </div>

      <NewRunModal open={isNewRunModalOpen} onOpenChange={setIsNewRunModalOpen} />
    </div>
  );
}

function NavItem({ href, icon: Icon, label, active, badge, badgeColor, onClick }: { href: string; icon: any; label: string; active?: boolean; badge?: string; badgeColor?: string; onClick?: () => void }) {
  if (active) {
    return (
      <Link
        href={href}
        onClick={onClick}
        className="flex items-center gap-3 px-3 py-2 bg-white shadow-sm border border-slate-200 text-slate-900 font-medium rounded-lg text-sm relative overflow-hidden transition-all"
      >
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-accent-ink" />
        <Icon className="h-4 w-4 shrink-0 text-accent-ink" />
        <span className="truncate">{label}</span>
        {badge && <span className={cn(`ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold`, badgeColor)}>{badge}</span>}
      </Link>
    );
  }
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2 text-slate-600 hover:bg-white hover:shadow-sm hover:text-slate-900 hover:border-slate-200 border border-transparent rounded-lg text-sm font-medium transition-all"
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
      {badge && <span className={cn(`ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold`, badgeColor)}>{badge}</span>}
    </Link>
  );
}

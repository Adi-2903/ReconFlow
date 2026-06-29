import { Building, Database, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export function EmptyDashboardState() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center min-h-[500px] w-full px-4 text-center animate-in fade-in duration-500">
      <div className="w-16 h-16 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-center mb-6 shadow-sm">
        <Sparkles className="w-8 h-8 text-indigo-600" />
      </div>
      
      <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mb-3">
        Welcome to <span className="font-brand font-normal">Recon<span className="italic text-accent-ink">F</span>low</span>!
      </h2>
      <p className="text-slate-500 max-w-[500px] mb-10 text-base sm:text-lg">
        You haven&apos;t connected any data sources yet. How would you like to get started?
      </p>

      <div className="grid sm:grid-cols-2 gap-4 w-full max-w-[600px]">
        {/* Connect Accounts Card */}
        <div className="flex flex-col items-start text-left p-6 bg-white border border-slate-200 rounded-xl shadow-sm hover:border-slate-300 transition-all">
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center mb-4">
            <Building className="w-5 h-5 text-blue-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">Connect Accounts</h3>
          <p className="text-sm text-slate-500 mb-6 flex-1">
            Link your bank, Stripe, or QuickBooks to start reconciling live data.
          </p>
          <Button 
            className="w-full bg-slate-900 hover:bg-slate-800 text-white" 
            onClick={() => router.push("/onboarding")}
          >
            Start Setup <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>

        {/* Explore Demo Data Card */}
        <div className="flex flex-col items-start text-left p-6 bg-white border border-slate-200 rounded-xl shadow-sm hover:border-slate-300 transition-all">
          <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center mb-4">
            <Database className="w-5 h-5 text-amber-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">Explore Demo Data</h3>
          <p className="text-sm text-slate-500 mb-6 flex-1">
            See how ReconFlow works by loading a full sandbox of mock transactions.
          </p>
          <Button 
            variant="outline" 
            className="w-full border-slate-200 hover:bg-slate-50"
            onClick={() => window.location.href = "?demo=true"}
          >
            Load Demo <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}

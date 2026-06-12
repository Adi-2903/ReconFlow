"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, Building, Landmark, Server, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isSeeding, setIsSeeding] = useState(false);

  const handleSeedDemo = async () => {
    setIsSeeding(true);
    try {
      await fetch("/api/seed", { method: "POST" });
      setStep(4); // Skip to end
    } catch (error) {
      console.error(error);
      alert("Failed to seed demo data");
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-100">
        
        {/* Progress Bar */}
        <div className="flex w-full bg-slate-100 h-2">
          <div 
            className="bg-indigo-600 h-full transition-all duration-500 ease-in-out"
            style={{ width: `${(step / 4) * 100}%` }}
          />
        </div>

        <div className="p-8 md:p-12">
          {/* Step 1: Welcome */}
          {step === 1 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-6">
                <Sparkles className="w-6 h-6 text-indigo-600" />
              </div>
              <h1 className="text-3xl font-bold text-slate-900 mb-3">Welcome to ReconFlow</h1>
              <p className="text-slate-500 text-lg mb-8">
                The AI-powered reconciliation engine for modern finance teams. Let's get your accounts connected so you can stop matching rows manually.
              </p>
              
              <div className="space-y-4">
                <div className="p-4 border border-slate-200 rounded-xl bg-slate-50 flex items-start gap-4">
                  <div className="mt-1">
                    <Building className="w-5 h-5 text-slate-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-slate-900">Your Workspace</h3>
                    <p className="text-sm text-slate-500">Demo Company Inc.</p>
                  </div>
                </div>
              </div>

              <div className="mt-10 flex items-center justify-between">
                <button onClick={handleSeedDemo} className="text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline">
                  Skip setup & load demo data
                </button>
                <Button onClick={() => setStep(2)} size="lg" className="bg-slate-900 hover:bg-slate-800">
                  Continue <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Connect Bank */}
          {step === 2 && (
            <div className="animate-in fade-in slide-in-from-right-8 duration-500">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-6">
                <Landmark className="w-6 h-6 text-blue-600" />
              </div>
              <h1 className="text-3xl font-bold text-slate-900 mb-3">Connect your Bank</h1>
              <p className="text-slate-500 text-lg mb-8">
                ReconFlow needs read-only access to your bank transactions or payment gateway.
              </p>
              
              <div className="space-y-4">
                <Button 
                  onClick={() => router.push("/connect")} 
                  className="w-full justify-between h-14 text-base font-normal bg-white border border-slate-200 text-slate-900 hover:bg-slate-50 hover:border-slate-300"
                >
                  <span className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-indigo-600 flex items-center justify-center text-white font-bold text-sm">S</div>
                    Connect Stripe
                  </span>
                  <ChevronRight className="w-5 h-5 text-slate-400" />
                </Button>

                <Button 
                  onClick={() => router.push("/connect")} 
                  className="w-full justify-between h-14 text-base font-normal bg-white border border-slate-200 text-slate-900 hover:bg-slate-50 hover:border-slate-300"
                >
                  <span className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 font-bold text-xs">CSV</div>
                    Upload Bank Statement
                  </span>
                  <ChevronRight className="w-5 h-5 text-slate-400" />
                </Button>
              </div>

              <div className="mt-10 flex items-center justify-between">
                <button onClick={() => setStep(1)} className="text-sm font-medium text-slate-500 hover:text-slate-900">Back</button>
                <Button onClick={() => setStep(3)} variant="outline">Skip for now</Button>
              </div>
            </div>
          )}

          {/* Step 3: Connect Ledger */}
          {step === 3 && (
            <div className="animate-in fade-in slide-in-from-right-8 duration-500">
              <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mb-6">
                <Server className="w-6 h-6 text-green-600" />
              </div>
              <h1 className="text-3xl font-bold text-slate-900 mb-3">Connect your Ledger</h1>
              <p className="text-slate-500 text-lg mb-8">
                Where do your invoices and internal accounting records live?
              </p>
              
              <div className="space-y-4">
                <Button 
                  onClick={() => router.push("/connect")} 
                  className="w-full justify-between h-14 text-base font-normal bg-white border border-slate-200 text-slate-900 hover:bg-slate-50 hover:border-slate-300"
                >
                  <span className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#2CA01C] flex items-center justify-center text-white font-bold text-xs">qb</div>
                    Connect QuickBooks
                  </span>
                  <ChevronRight className="w-5 h-5 text-slate-400" />
                </Button>
              </div>

              <div className="mt-10 flex items-center justify-between">
                <button onClick={() => setStep(2)} className="text-sm font-medium text-slate-500 hover:text-slate-900">Back</button>
                <Button onClick={() => setStep(4)} variant="outline">Skip for now</Button>
              </div>
            </div>
          )}

          {/* Step 4: Success */}
          {step === 4 && (
            <div className="animate-in fade-in zoom-in-95 duration-500 text-center">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-10 h-10 text-green-600" />
              </div>
              <h1 className="text-3xl font-bold text-slate-900 mb-3">You're all set!</h1>
              <p className="text-slate-500 text-lg mb-8 max-w-md mx-auto">
                {isSeeding ? "Demo data has been loaded." : "Your accounts are connected."} The AI engine is ready to run your first reconciliation.
              </p>
              
              <Button onClick={() => router.push("/dashboard")} size="lg" className="bg-slate-900 hover:bg-slate-800 w-full sm:w-auto px-12">
                Go to Dashboard
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

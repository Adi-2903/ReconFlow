"use client";

import React, { Component, ReactNode, ErrorInfo } from "react";
import { toast } from "@/lib/toast";

interface AppErrorBoundaryProps {
  children: ReactNode;
  fallbackRoute?: string;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_error: Error): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    
    if (error.message && error.message.toLowerCase().includes('match')) {
      const action = error.message.toLowerCase().includes('reject') ? 'reject' : 'approve';
      toast.matchFailed(action);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-slate-50 flex items-center justify-center p-4 z-[9999]">
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm w-full max-w-[400px] p-6 text-center">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Something went wrong</h2>
            <p className="text-slate-500 text-sm mb-6">Your data is safe. This screen had an error.</p>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => window.location.reload()}
                className="w-full bg-slate-900 text-white hover:bg-slate-800 rounded-md py-2 text-sm font-medium transition-colors"
              >
                Refresh page
              </button>
              <a 
                href={this.props.fallbackRoute || "/dashboard"}
                className="w-full bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:text-slate-900 rounded-md py-2 text-sm font-medium transition-colors block cursor-pointer"
              >
                Go to dashboard
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

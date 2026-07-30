"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * /demo — Recruiter demo entry point.
 *
 * Redirects immediately to /dashboard?demo=true.
 * Share this URL with recruiters: https://your-app.vercel.app/demo
 */
export default function DemoPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard?demo=true");
  }, [router]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 font-sans">
      <div className="w-full max-w-sm bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center">
        <div className="relative size-10 mx-auto mb-5">
          <div className="absolute inset-0 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
        </div>
        <p className="text-sm text-slate-500 font-medium">Loading demo environment...</p>
      </div>
    </div>
  );
}

"use client";

import dynamic from "next/dynamic";

// ssr: false must live in a Client Component — not allowed in Server Components.
// This thin wrapper is the only way to use dynamic() with ssr: false in
// Next.js App Router. It prevents React hydration errors caused by browser
// extensions (e.g. Dashlane) that inject attributes like fdprocessedid into
// buttons/inputs before React hydrates server-rendered HTML.
const LandingPage = dynamic(
  () => import("@/components/landing-page"),
  {
    ssr: false,
    loading: () => <div className="min-h-screen bg-white" />,
  }
);

export function LandingPageClient({ isLoggedIn }: { isLoggedIn: boolean }) {
  return <LandingPage isLoggedIn={isLoggedIn} />;
}

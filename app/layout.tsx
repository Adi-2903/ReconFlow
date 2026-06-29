import type {Metadata} from 'next';
import './globals.css';
import { Geist } from "next/font/google";
import localFont from "next/font/local";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/Providers";
import { DataProvider } from "@/lib/data-context";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/auth";
import { DemoBanner } from "@/components/demo-banner";
import { Toaster } from "sonner";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});
const gcEpicPro = localFont({
  src: '../font/GC-EPICPRO-Demo-BF6891cc5419ab8.ttf',
  variable: '--font-brand',
});

export const metadata: Metadata = {
  title: 'ReconFlow - Bank Reconciliation',
  description: 'AI-powered bank reconciliation SaaS for Indian startups',
};

export default async function RootLayout({children}: {children: React.ReactNode}) {
  const session = await auth();

  return (
    <SessionProvider session={session}>
      <html lang="en" className={cn("font-sans", geist.variable, gcEpicPro.variable)} suppressHydrationWarning>
        <body suppressHydrationWarning>
          <DataProvider>
            <DemoBanner />
            <AppShell>
              <Providers>{children}</Providers>
            </AppShell>
          </DataProvider>
          <Toaster position="bottom-right" richColors />
        </body>
      </html>
    </SessionProvider>
  );
}

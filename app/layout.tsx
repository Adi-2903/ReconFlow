import type {Metadata} from 'next';
import './globals.css';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/Providers";
import { Toaster } from "sonner";
import { DataProvider } from "@/lib/data-context";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/auth";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'ReconFlow - Bank Reconciliation',
  description: 'AI-powered bank reconciliation SaaS for Indian startups',
};

export default async function RootLayout({children}: {children: React.ReactNode}) {
  const session = await auth();

  return (
    <SessionProvider session={session}>
      <html lang="en" className={cn("font-sans", geist.variable)}>
        <body suppressHydrationWarning>
          <DataProvider>
            <AppShell>
              <Providers>{children}</Providers>
            </AppShell>
            <Toaster position="bottom-right" richColors />
          </DataProvider>
        </body>
      </html>
    </SessionProvider>
  );
}


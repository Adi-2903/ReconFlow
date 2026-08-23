import { auth } from "@/auth";
import { LandingPageClient } from "@/components/landing-page-client";

export default async function Home() {
  const session = await auth();
  const isLoggedIn = !!session?.user;

  return <LandingPageClient isLoggedIn={isLoggedIn} />;
}

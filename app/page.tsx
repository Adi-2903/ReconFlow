import { auth } from "@/auth";
import LandingPage from "@/components/landing-page";

export default async function Home() {
  const session = await auth();
  const isLoggedIn = !!session?.user;

  return <LandingPage isLoggedIn={isLoggedIn} />;
}

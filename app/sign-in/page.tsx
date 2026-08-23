import { redirect } from "next/navigation";

// Server-side redirect — instant, no flash, no JS required.
// NextAuth uses /sign-in as the signIn page, so any unauthenticated
// navigation lands here and is immediately bounced to the landing page
// with the auth modal pre-opened via the `auth=true` query param.
export default function SignInPage() {
  redirect("/?auth=true");
}

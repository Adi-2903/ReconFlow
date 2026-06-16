import { auth } from "@/auth";
import { disconnectStripe } from "@/services/stripe.service";

export async function POST() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const result = await disconnectStripe(userId);
    return Response.json(result);
  } catch (error) {
    console.error("Error disconnecting Stripe:", error);
    return Response.json({ error: "Failed to disconnect Stripe" }, { status: 500 });
  }
}

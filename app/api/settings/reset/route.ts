import { auth } from "@/auth";
import { resetReconData } from "@/services/settings.service";

export async function POST() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const result = await resetReconData(userId);
    return Response.json(result);
  } catch (error) {
    console.error("Error resetting data:", error);
    return Response.json({ error: "Failed to reset data" }, { status: 500 });
  }
}

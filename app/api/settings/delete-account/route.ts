import { auth } from "@/auth";
import { deleteAccount } from "@/services/settings.service";

export async function POST() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const result = await deleteAccount(userId);
    return Response.json(result);
  } catch (error) {
    console.error("Error deleting account:", error);
    return Response.json({ error: "Failed to delete account" }, { status: 500 });
  }
}

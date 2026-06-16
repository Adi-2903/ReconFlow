import { auth } from "@/auth";
import { listExceptions } from "@/services/exceptions.service";

export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const result = await listExceptions(userId);
    return Response.json(result);
  } catch (error) {
    console.error("Error fetching exceptions:", error);
    return Response.json({ error: "Failed to fetch exceptions" }, { status: 500 });
  }
}

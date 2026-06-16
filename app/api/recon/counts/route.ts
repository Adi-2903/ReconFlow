import { auth } from "@/auth";
import { getReconCounts } from "@/services/recon.service";

export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const counts = await getReconCounts(userId);
    return Response.json(counts);
  } catch (error) {
    console.error("Error fetching recon counts:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

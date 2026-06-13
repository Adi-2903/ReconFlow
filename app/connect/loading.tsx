import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export default function ConnectLoading() {
  return (
    <div className="w-full max-w-[720px] mx-auto py-12 md:py-16 px-4 flex flex-col gap-10 min-h-screen">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[1, 2].map((i) => (
          <Card key={i} className="p-6 space-y-4">
            <div className="flex justify-between items-center">
              <Skeleton className="h-10 w-10 rounded-md" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-10 w-full mt-4" />
          </Card>
        ))}
      </div>
    </div>
  );
}

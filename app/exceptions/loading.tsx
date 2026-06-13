import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export default function ExceptionsLoading() {
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-4 md:p-6 gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>

      <Card className="flex-1 p-6 space-y-4">
        <div className="flex justify-between pb-4 border-b">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-6 w-24" />
        </div>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-4 items-center p-4 border rounded-lg">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </Card>
    </div>
  );
}

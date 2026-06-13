import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export default function ReportsLoading() {
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-4 md:p-6 gap-6">
      <div className="flex justify-between items-center">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-32" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-4 space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
          </Card>
        ))}
      </div>

      <Card className="flex-1 p-6 space-y-4">
        <Skeleton className="h-[300px] w-full" />
      </Card>
    </div>
  );
}

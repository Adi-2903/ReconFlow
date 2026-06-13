import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export default function SettingsLoading() {
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-4 md:p-6 gap-6 max-w-4xl mx-auto w-full">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="flex gap-6">
        <div className="w-48 space-y-2 hidden md:block">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
        
        <Card className="flex-1 p-6 space-y-6">
          <Skeleton className="h-6 w-32" />
          <div className="space-y-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
            <Skeleton className="h-10 w-32 mt-4" />
          </div>
        </Card>
      </div>
    </div>
  );
}

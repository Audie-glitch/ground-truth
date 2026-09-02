import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading passport">
      <div>
        <Skeleton className="h-3 w-16" />
        <Skeleton className="mt-2 h-7 w-full max-w-xl" />
      </div>
      <section className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <Skeleton className="h-3 w-12" />
            <Skeleton className="mt-2 h-12 w-32" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </CardContent>
        </Card>
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-2 h-9 w-40" />
              </CardHeader>
            </Card>
          ))}
          <Card className="sm:col-span-2">
            <CardContent className="space-y-2 py-6">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </CardContent>
          </Card>
        </div>
      </section>
      <Card>
        <CardContent className="space-y-3 py-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

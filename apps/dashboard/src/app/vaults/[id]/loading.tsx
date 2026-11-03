import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function VaultLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Vault</h1>
      <p className="sr-only" role="status">
        Loading vault
      </p>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Skeleton className="h-[7.5rem] w-full rounded-lg" />
        <Skeleton className="h-[7.5rem] w-full rounded-lg" />
        <Skeleton className="h-[7.5rem] w-full rounded-lg" />
        <Skeleton className="h-[7.5rem] w-full rounded-lg" />
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

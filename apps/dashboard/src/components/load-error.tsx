import { CircleAlert, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Read failure with a retry, used in place of a skeleton that would otherwise never resolve. */
export function LoadError({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail?: string | null;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-md border border-rejected-fill/30 bg-rejected-fill/[0.06] p-4 sm:flex-row sm:items-center"
    >
      <CircleAlert aria-hidden className="size-5 shrink-0 text-rejected" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        <RotateCw aria-hidden />
        Try again
      </Button>
    </div>
  );
}

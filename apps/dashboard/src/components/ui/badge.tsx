import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium motion-safe:transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/15 text-accent',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        muted: 'border-transparent bg-muted font-mono text-muted-foreground',
        warning: 'border-transparent bg-warning/15 text-warning',
        destructive: 'border-transparent bg-rejected-fill/15 text-rejected',
        info: 'border-transparent bg-info/15 text-info',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

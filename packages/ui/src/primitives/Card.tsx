import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

/** Elevation level 1. In dark mode bg-surface-raised is a subtle vertical
 *  gradient and shadow-e1 includes a 1px inner top highlight; in light mode
 *  both collapse to flat-plus-shadow. Components never branch on theme. */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-card border border-line-subtle bg-surface-raised shadow-e1',
        'dark:border-t-line',
        className,
      )}
      {...rest}
    />
  );
});

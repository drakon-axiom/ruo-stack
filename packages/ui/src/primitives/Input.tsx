import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, id, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      id={id}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid && id ? `${id}-error` : undefined}
      className={cn(
        // No outline-none here: the global focus-visible ring in tokens.css is
        // the focus indicator. The old .input class suppressed it.
        'min-h-11 w-full rounded-[10px] border bg-surface-1 px-3 text-base text-content',
        'placeholder:text-content-faint transition-colors duration-fast md:min-h-0 md:py-2 md:text-sm',
        invalid ? 'border-danger' : 'border-line focus:border-accent',
        className,
      )}
      {...rest}
    />
  );
});

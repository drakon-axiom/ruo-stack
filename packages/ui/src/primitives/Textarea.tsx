import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, id, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      id={id}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid && id ? `${id}-error` : undefined}
      className={cn(
        'w-full rounded-[10px] border bg-field px-3 py-2 text-sm text-content',
        'placeholder:text-content-muted transition-colors duration-fast',
        invalid ? 'border-danger' : 'border-line focus:border-accent',
        className,
      )}
      {...rest}
    />
  );
});

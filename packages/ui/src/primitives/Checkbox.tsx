import * as RC from '@radix-ui/react-checkbox';
import { Check, Minus } from '../icons.js';
import { cn } from '../lib/cn.js';

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  id,
  indeterminate = false,
  hideLabel = false,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  id?: string;
  /** Renders the "some, not all" state (aria-checked="mixed"). Display only —
   *  the callback stays a plain boolean, so callers decide what a click means. */
  indeterminate?: boolean;
  /** Keeps `label` as the accessible name but hides it visually, for dense
   *  contexts like a table header where the column speaks for itself. */
  hideLabel?: boolean;
}) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center text-sm text-content', !hideLabel && 'gap-2')}>
      <RC.Root
        id={id}
        checked={indeterminate ? 'indeterminate' : checked}
        // Radix models the indeterminate state as 'indeterminate'; collapse it
        // to false so consumers only ever deal with a boolean.
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border border-line bg-surface-1 data-[state=checked]:border-accent-solid data-[state=checked]:bg-accent-solid data-[state=indeterminate]:border-accent-solid data-[state=indeterminate]:bg-accent-solid"
      >
        <RC.Indicator>
          {indeterminate ? (
            <Minus aria-hidden className="h-3.5 w-3.5 text-white" />
          ) : (
            <Check aria-hidden className="h-3.5 w-3.5 text-white" />
          )}
        </RC.Indicator>
      </RC.Root>
      {hideLabel ? <span className="sr-only">{label}</span> : label}
    </label>
  );
}

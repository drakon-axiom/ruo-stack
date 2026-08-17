import * as RS from '@radix-ui/react-select';
import { cn } from '../lib/cn.js';
import { Check, ChevronDown, ChevronUp } from '../icons.js';

/**
 * Scroll affordance. Radix renders these only while there is more list in that
 * direction, and they are the reason it hides the native scrollbar by default.
 *
 * They exist here because a scrollbar alone cannot be relied on: overlay
 * scrollbars (macOS always, and Chromium depending on platform and settings)
 * paint nothing at rest, so a long list looks like it simply ends. These are
 * real elements, so the affordance is there on every platform.
 */
const scrollButtonClass = 'flex h-6 cursor-default items-center justify-center bg-surface-2 text-content-faint';

export interface SelectOption {
  value: string;
  label: string;
}

export function Select({
  options,
  value,
  onValueChange,
  placeholder = 'Select…',
  id,
  className,
  disabled,
}: {
  options: SelectOption[];
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <RS.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RS.Trigger
        id={id}
        className={cn(
          'inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-[10px]',
          'border border-line bg-field px-3 text-base text-content md:min-h-0 md:py-2 md:text-sm',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        <RS.Value placeholder={placeholder} />
        <ChevronDown aria-hidden className="h-4 w-4 text-content-faint" />
      </RS.Trigger>

      <RS.Portal>
        {/* Bounded to the space actually on screen. Radix already sets
         *  `overflow: hidden auto` on the viewport inline, so scrolling is not
         *  what was missing — a height bound is. Without one, a long option list
         *  grows to fit every item and runs off the bottom of the screen, where
         *  it cannot be reached. `overflow-hidden` stays so the rounded corners
         *  still clip the scrolling viewport inside. */}
        <RS.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[var(--radix-select-content-available-height)] overflow-hidden rounded-[10px] border border-line bg-surface-2 shadow-e2"
        >
          <RS.ScrollUpButton className={scrollButtonClass}>
            <ChevronUp aria-hidden className="h-4 w-4" />
          </RS.ScrollUpButton>

          {/* Radix injects `[data-radix-select-viewport]{scrollbar-width:none}`
           *  plus `::-webkit-scrollbar{display:none}` at runtime, because the
           *  chevrons above and below are meant to be the only affordance. We
           *  restore the scrollbar as well: where the platform draws a classic
           *  one it also shows how MUCH more there is, which a chevron cannot.
           *  The chevrons stay because that is not guaranteed — overlay
           *  scrollbars paint nothing at rest.
           *
           *  The `!` modifiers are load-bearing: Radix appends that <style> to
           *  <head> after the stylesheet link, so it wins on equal specificity
           *  and a plain utility would silently lose. */}
          <RS.Viewport
            className={cn(
              'p-1',
              // `auto`, not `thin`: Chromium ignores every ::-webkit-scrollbar
              // rule below the moment scrollbar-width is set to anything else,
              // and `thin` there yields an overlay bar that only paints while
              // actively scrolling — invisible at rest, which is the whole
              // complaint. `auto` hands Chromium back to the ::-webkit rules and
              // still gives Firefox a normal, always-visible scrollbar.
              '![scrollbar-width:auto] [scrollbar-color:var(--border-default)_transparent]',
              '[&::-webkit-scrollbar]:!block [&::-webkit-scrollbar]:w-2',
              '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-line',
              '[&::-webkit-scrollbar-track]:bg-transparent',
            )}
          >
            {options.map((o) => (
              <RS.Item
                key={o.value}
                value={o.value}
                className="flex cursor-pointer items-center justify-between rounded-md px-2.5 py-2 text-sm text-content-muted outline-none data-[highlighted]:bg-surface-3 data-[highlighted]:text-content"
              >
                <RS.ItemText>{o.label}</RS.ItemText>
                <RS.ItemIndicator>
                  <Check aria-hidden className="h-4 w-4 text-accent" />
                </RS.ItemIndicator>
              </RS.Item>
            ))}
          </RS.Viewport>

          <RS.ScrollDownButton className={scrollButtonClass}>
            <ChevronDown aria-hidden className="h-4 w-4" />
          </RS.ScrollDownButton>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}

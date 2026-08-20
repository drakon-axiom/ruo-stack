import { useEffect, useState } from 'react';
import { Button, ChevronLeft, ChevronRight, Dialog, cn } from '@ruostack/ui';
import { WELCOME_SLIDES, slideTitle } from './welcomeSlides.js';

/**
 * The first-run welcome tour: five slides explaining the white-label
 * fulfillment model, ending by pointing at the Get started checklist on
 * Overview.
 *
 * Presentational only — whether it should be open, and what dismissing it
 * persists, belong to lib/onboarding.tsx. This component just walks slides and
 * reports that the user is done.
 *
 * EVERY exit path reports dismissal: Skip, the Dialog's X, Escape, an overlay
 * click, and finishing the last slide. The tour is informational, so there is no
 * reason to trap anyone in it, and a user who escapes past it has still made a
 * decision about it. Radix funnels all four close gestures through
 * `onOpenChange`, so that is one handler rather than five.
 */
export function WelcomeTour({
  open,
  firstName,
  onDismiss,
}: {
  open: boolean;
  firstName: string;
  /** true = reached the end and pressed Get started; false = skipped, X, Esc, overlay. */
  onDismiss: (finished: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  // Non-null assertion: index is always kept in [0, WELCOME_SLIDES.length) by
  // the handlers below (Back only renders past 0, Next only increments before
  // the last slide), but noUncheckedIndexedAccess still types array access as
  // possibly undefined.
  const slide = WELCOME_SLIDES[index]!;
  const isLast = index === WELCOME_SLIDES.length - 1;

  // Restart at slide 1 whenever the tour is reopened, so a replay from Account
  // does not drop the user back on whichever slide they quit from.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss(false);
      }}
      title={slideTitle(slide, firstName)}
    >
      <p className="text-sm leading-relaxed text-content-muted">{slide.body}</p>

      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5" aria-hidden>
          {WELCOME_SLIDES.map((s, i) => (
            <span
              key={s.title}
              className={cn(
                'h-1.5 rounded-full transition-all duration-fast',
                i === index ? 'w-4 bg-accent' : 'w-1.5 bg-line',
              )}
            />
          ))}
        </div>
        <span className="text-2xs text-content-faint">
          Step {index + 1} of {WELCOME_SLIDES.length}
        </span>
      </div>

      <div className="mt-5 flex items-center justify-between gap-2 border-t border-line pt-4">
        <Button variant="ghost" size="sm" onClick={() => onDismiss(false)}>
          Skip
        </Button>
        <div className="flex gap-2">
          {index > 0 && (
            <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={() => setIndex((i) => i - 1)}>
              Back
            </Button>
          )}
          <Button
            size="sm"
            icon={ChevronRight}
            onClick={() => (isLast ? onDismiss(true) : setIndex((i) => i + 1))}
          >
            {isLast ? 'Get started' : 'Next'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

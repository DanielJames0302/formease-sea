'use client';

import * as React from 'react';
import { useNextStep } from 'nextstepjs';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HelpCircle } from 'lucide-react';

type HelpTourButtonProps = {
  /** The tour id you defined in <NextStep steps=[{ tour: '...' }]> */
  tour?: string;
  /** Optional: start at a specific step key (if you named steps). */
  step?: string;
} & React.ComponentProps<typeof Button>;

export function HelpTourButton({
  tour = 'mainTour',
  step,
  className,
  ...buttonProps
}: HelpTourButtonProps) {
  const { startNextStep } = useNextStep();

  const onClick = React.useCallback(() => {
    // Call with step if provided, otherwise start at beginning
    // @ts-expect-error accommodate both signatures depending on lib version
    step ? startNextStep(tour, step) : startNextStep(tour);
  }, [startNextStep, tour, step]);

  return (
    <Button
      variant="outline"
      aria-label="Help"
      onClick={onClick}
      className={cn('flex items-center gap-2 md:h-[34px]', className)}
      {...buttonProps}
    >
      <HelpCircle className="size-4" />
      <span>Guide</span>
    </Button>
  );
}

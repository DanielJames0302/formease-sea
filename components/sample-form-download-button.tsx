// SampleFormDownloadButton.tsx
'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Download } from 'lucide-react';

export function SampleFormDownloadButton({ className }: { className?: string }) {
  return (
    <Button
      asChild
      variant="secondary"
      id="sample-form-download"
      className={cn('gap-2', className)}
    >
      <a href="/forms/sea-sample-form.pdf" download="sea-sample-form.pdf">
        <Download className="h-4 w-4" />
        <span>Download sample form</span>
      </a>
    </Button>
  );
}

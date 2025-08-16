'use client';

import { NextStepProvider, NextStep, useNextStep, type Tour } from 'nextstepjs';
import { Toaster } from 'sonner';
import { SessionProvider } from 'next-auth/react';
import { PropsWithChildren, useEffect } from 'react';

const steps: Tour[] = [
  {
    tour: 'firsttour',
    steps: [
      {
        icon: <>🌏</>,
        title: 'Welcome to FormEase-SEA',
        content: (
          <>
            This app is a <strong>chatbot system</strong> that <strong>automates form filling</strong> for
            files uploaded by users, specifically optimized for the <strong>SEA region</strong>.
          </>
        ),
        selector: '#main-anchor',           // e.g. your app logo/header
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        pointerRadius: 10,
      },
      {
        icon: <>📄</>,
        title: 'Step 1 — Upload your form (PDF)',
        content: (
          <>
            Start by <strong>uploading the form as a PDF</strong>. We’ll parse fields and prepare them for automation.
          </>
        ),
        selector: '#upload-form-button',     // e.g. the upload button or dropzone
        side: 'top',
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        pointerRadius: 10,
      },
      {
        icon: <>💬</>,
        title: 'Step 2 — Chat to provide details',
        content: (
          <>
            The bot will <strong>chat with you</strong> to collect any missing information needed to complete the form.
          </>
        ),
        selector: '#chat-panel',             // e.g. chat container
        side: 'bottom',
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        pointerRadius: 10,
      },
      {
        icon: <>⚙️</>,
        title: 'Step 3 — Automated form filling',
        content: (
          <>
            After gathering info, the system will <strong>auto-fill the form</strong> for you—no manual typing.
          </>
        ),
        selector: '#automation-status',      // e.g. a progress/status area
        side: 'top',
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        pointerRadius: 10,
      },
      {
        icon: <>🔗</>,
        title: 'Step 4 — Download filled form',
        content: (
          <>
            When ready, click the <strong>download link</strong> to get your <strong>filled PDF</strong>.
          </>
        ),
        selector: '#filled-form-download',   // e.g. a “Download” link/button
        side: 'top',
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        pointerRadius: 10,
      },
      {
        icon: <>🧪</>,
        title: 'Try it — Sample form',
        content: (
          <>
            Don’t have a form yet? <strong>Download a sample form</strong> and try the workflow.
          </>
        ),
        selector: '#sample-form-download',   // e.g. “Download sample” link/button
        side: 'bottom',
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        pointerRadius: 10,
      },
    ],
  },
  {
    tour: 'secondtour',
    steps: [
      {
        icon: <>🚀</>,
        title: 'Second tour, Step 1',
        content: <>Second tour, first step!</>,
        selector: '#nextstep-step1',
        side: 'top',
        showControls: true,
        showSkip: true,
        pointerPadding: 10,
        pointerRadius: 10,
      },
    ],
  },
];

function AutoStart() {
  // optional: auto-start a tour on first paint
  const { startNextStep } = useNextStep();
  useEffect(() => {
    // Start the first tour or specify 'firsttour'
    startNextStep('firsttour');
  }, [startNextStep]);
  return null;
}

export default function NextStepClient({ children }: PropsWithChildren) {
  return (
    <NextStepProvider>
      <NextStep steps={steps}>
        <Toaster position="top-center" />
        <SessionProvider>
          <AutoStart />
          {children}
        </SessionProvider>
      </NextStep>
    </NextStepProvider>
  );
}

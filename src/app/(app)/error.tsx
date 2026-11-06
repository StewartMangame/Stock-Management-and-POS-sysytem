'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled app error:', error);
  }, [error]);

  return (
    <div className="flex h-full min-h-[400px] flex-col items-center justify-center p-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600">
        <AlertTriangle className="h-7 w-7" />
      </div>
      <h2 className="mt-4 text-xl font-bold text-ace-navy">Something went wrong</h2>
      <p className="mt-2 max-w-md text-sm text-ace-muted">
        {error?.message || 'An unexpected error occurred while loading this page.'}
      </p>
      {error?.digest && (
        <p className="mt-1 text-xs text-gray-400">Error digest: {error.digest}</p>
      )}
      <button
        onClick={() => reset()}
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-ace-navy px-4 py-2 text-sm font-medium text-white transition hover:bg-ace-navy/90"
      >
        <RotateCcw className="h-4 w-4" />
        Try Again
      </button>
    </div>
  );
}


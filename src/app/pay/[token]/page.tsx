/**
 * Public payment link page — /pay/[token]
 * No authentication required (whitelisted in auth.config.ts).
 * Server Component: validates the token and renders appropriate state.
 */
import type { Metadata } from 'next';
import { getPaymentLinkPublicData } from '@/server/services/integrations/payment-links';
import { PaymentClient, type LinkData } from './PaymentClient';

export const metadata: Metadata = {
  title: 'Pay Invoice',
};

interface Props {
  params: Promise<{ token: string }>;
}

export default async function PaymentLinkPage({ params }: Props) {
  const { token } = await params;

  let linkData: Awaited<ReturnType<typeof getPaymentLinkPublicData>>;
  try {
    linkData = await getPaymentLinkPublicData(token);
  } catch {
    linkData = { valid: false, error: 'An unexpected error occurred.' };
  }

  if (!linkData.valid) {
    return (
      <div className="min-h-screen bg-muted/40 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-background rounded-xl shadow-lg p-8 text-center space-y-4">
          <div className="text-5xl">🔗</div>
          <h1 className="text-xl font-semibold text-foreground">Link Unavailable</h1>
          <p className="text-muted-foreground text-sm">
            {linkData.error ?? 'This payment link is invalid or has expired.'}
          </p>
        </div>
      </div>
    );
  }

  if (linkData.isPaid) {
    return (
      <div className="min-h-screen bg-muted/40 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-background rounded-xl shadow-lg p-8 text-center space-y-4">
          <div className="text-5xl">✅</div>
          <h1 className="text-xl font-semibold text-foreground">Already Paid</h1>
          <p className="text-muted-foreground text-sm">
            Invoice <span className="font-mono font-medium">{linkData.invoice?.documentNumber}</span> has
            already been fully paid. Thank you!
          </p>
        </div>
      </div>
    );
  }

  // Active link — render interactive payment form
  return (
    <div className="min-h-screen bg-muted/40 flex items-center justify-center p-4">
      <PaymentClient token={token} linkData={linkData as unknown as LinkData} />
    </div>
  );
}


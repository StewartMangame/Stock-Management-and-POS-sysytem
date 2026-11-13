/**
 * OneKhusa Integration Module Export & Provider Factory.
 */

import { PaymentProvider } from './types';
import { OneKhusaClient } from './client';
import { MockPaymentProvider } from './mock';
import { assertMocksAllowed, isProduction } from '@/lib/env';

export * from './types';
export * from './client';
export * from './mock';

let activeProvider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (activeProvider) {
    return activeProvider;
  }

  const mode = (process.env.ONEKHUSA_MODE || process.env.PAYMENT_PROVIDER || (process.env.ONEKHUSA_API_KEY ? 'live' : 'mock')).toLowerCase();
  const isMock = mode === 'mock';

  if (isMock) {
    assertMocksAllowed('OneKhusa Payment Gateway');
    activeProvider = new MockPaymentProvider();
  } else {
    activeProvider = new OneKhusaClient();
  }

  return activeProvider;
}

export function setPaymentProvider(provider: PaymentProvider) {
  activeProvider = provider;
}


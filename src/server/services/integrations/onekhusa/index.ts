/**
 * OneKhusa Integration Module Export & Provider Factory.
 */

import { PaymentProvider } from './types';
import { OneKhusaClient } from './client';
import { MockPaymentProvider } from './mock';

export * from './types';
export * from './client';
export * from './mock';

let activeProvider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (activeProvider) {
    return activeProvider;
  }

  const providerType = process.env.PAYMENT_PROVIDER || (process.env.ONEKHUSA_API_KEY ? 'onekhusa' : 'mock');

  if (providerType === 'mock') {
    activeProvider = new MockPaymentProvider();
  } else {
    activeProvider = new OneKhusaClient();
  }

  return activeProvider;
}

export function setPaymentProvider(provider: PaymentProvider) {
  activeProvider = provider;
}


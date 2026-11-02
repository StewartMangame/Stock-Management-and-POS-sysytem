/**
 * Mock MRA Electronic Invoicing System (EIS) Adapter.
 * Generates simulated fiscal receipts and QR codes for offline and development environments.
 */

import crypto from 'node:crypto';
import { EisAdapter, EisSubmissionPayload, EisSubmissionResponse } from './types';

export class MockEisAdapter implements EisAdapter {
  public name = 'mock_mra_eis';
  public shouldFail = false;

  async submit(payload: EisSubmissionPayload): Promise<EisSubmissionResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        receiptNumber: '',
        internalData: '',
        receiptSignature: '',
        qrCodeData: '',
        fiscalDay: '',
        errorMessage: 'Mock EIS connection timeout to MRA central server',
      };
    }

    const randomSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    const receiptNumber = `MRA-EIS-2026-${randomSuffix}`;
    const fiscalDay = new Date().toISOString().split('T')[0]!;

    const signature = crypto
      .createHash('sha256')
      .update(`${receiptNumber}-${payload.totalMinor}-${fiscalDay}`)
      .digest('hex')
      .slice(0, 32);

    const qrCodeData = `https://mra.mw/eis/verify?rn=${receiptNumber}&sig=${signature}&amt=${payload.totalMinor}`;

    return {
      success: true,
      receiptNumber,
      internalData: `FISCAL_DEVICE_001|${fiscalDay}|${receiptNumber}`,
      receiptSignature: signature,
      qrCodeData,
      fiscalDay,
      rawResponse: {
        status: 'ACCEPTED',
        receiptNumber,
        deviceSerialNumber: 'EIS-DEV-MRA-001',
      },
    };
  }
}

let activeEisAdapter: EisAdapter | null = null;

export function getEisAdapter(): EisAdapter {
  if (!activeEisAdapter) {
    activeEisAdapter = new MockEisAdapter();
  }
  return activeEisAdapter;
}

export function setEisAdapter(adapter: EisAdapter) {
  activeEisAdapter = adapter;
}


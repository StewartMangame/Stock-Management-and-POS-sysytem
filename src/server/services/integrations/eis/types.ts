/**
 * MRA Electronic Invoicing System (EIS) Types & Interfaces.
 */

export interface EisSubmissionPayload {
  documentId: string;
  documentNumber: string;
  documentType: 'invoice' | 'credit_note';
  issueDate: string;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  customer: {
    name: string;
    tin?: string;
    vrn?: string;
  };
  lines: Array<{
    lineNumber: number;
    description: string;
    quantity: string;
    unitPriceMinor: number;
    taxRateBasisPoints: number;
    taxMinor: number;
    lineTotalMinor: number;
  }>;
}

export interface EisSubmissionResponse {
  success: boolean;
  receiptNumber: string;
  internalData: string;
  receiptSignature: string;
  qrCodeData: string;
  fiscalDay: string;
  rawResponse?: any;
  errorMessage?: string;
}

export interface EisAdapter {
  name: string;
  submit(payload: EisSubmissionPayload): Promise<EisSubmissionResponse>;
}


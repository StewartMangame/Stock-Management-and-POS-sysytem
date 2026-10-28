import { describe, it, expect } from 'vitest';
import {
  computePaymentStatus,
  computeCustomerCreditAsOf,
  computeCustomerCreditLive,
  ageInvoiceBucket,
  allocateToAgedBuckets,
  validateMethodDetails,
} from '@/lib/payment-math';

describe('Payment Math & Validation', () => {
  describe('computePaymentStatus', () => {
    it('returns unpaid when paid is 0 and total > credited', () => {
      expect(computePaymentStatus(100000, 0, 0)).toBe('unpaid');
    });

    it('returns partly_paid when paid > 0 but less than net total', () => {
      expect(computePaymentStatus(100000, 0, 40000)).toBe('partly_paid');
      expect(computePaymentStatus(100000, 20000, 40000)).toBe('partly_paid');
    });

    it('returns paid when paid equals or exceeds net total', () => {
      expect(computePaymentStatus(100000, 0, 100000)).toBe('paid');
      expect(computePaymentStatus(100000, 30000, 70000)).toBe('paid');
      expect(computePaymentStatus(100000, 30000, 80000)).toBe('paid');
    });

    it('returns credited when total - credited <= 0 and paid is 0', () => {
      expect(computePaymentStatus(100000, 100000, 0)).toBe('credited');
      expect(computePaymentStatus(100000, 120000, 0)).toBe('credited');
    });
  });

  describe('computeCustomerCreditAsOf and Live', () => {
    it('computes credit = receipts - allocations - refunds', () => {
      expect(computeCustomerCreditLive(BigInt(500000), BigInt(300000), BigInt(50000))).toBe(BigInt(150000));
      expect(computeCustomerCreditAsOf(BigInt(500000), BigInt(300000), BigInt(50000))).toBe(BigInt(150000));
    });

    it('returns 0n if allocations + refunds >= receipts', () => {
      expect(computeCustomerCreditLive(BigInt(100000), BigInt(100000), BigInt(0))).toBe(BigInt(0));
      expect(computeCustomerCreditLive(BigInt(100000), BigInt(80000), BigInt(30000))).toBe(BigInt(0));
    });
  });

  describe('ageInvoiceBucket', () => {
    const asOf = new Date('2026-05-15');

    it('classifies not-yet-due or due-today invoices as current', () => {
      expect(ageInvoiceBucket('2026-05-15', asOf)).toBe('current');
      expect(ageInvoiceBucket('2026-05-20', asOf)).toBe('current');
    });

    it('classifies 1 to 30 days overdue', () => {
      expect(ageInvoiceBucket('2026-05-14', asOf)).toBe('days1_30'); // 1 day
      expect(ageInvoiceBucket('2026-04-15', asOf)).toBe('days1_30'); // 30 days
    });

    it('classifies 31 to 60 days overdue', () => {
      expect(ageInvoiceBucket('2026-04-14', asOf)).toBe('days31_60'); // 31 days
      expect(ageInvoiceBucket('2026-03-16', asOf)).toBe('days31_60'); // 60 days
    });

    it('classifies 61 to 90 days overdue', () => {
      expect(ageInvoiceBucket('2026-03-15', asOf)).toBe('days61_90');
      expect(ageInvoiceBucket('2026-02-15', asOf)).toBe('days61_90');
    });

    it('classifies 90+ days overdue', () => {
      expect(ageInvoiceBucket('2026-01-01', asOf)).toBe('days90plus');
    });
  });

  describe('allocateToAgedBuckets', () => {
    const asOf = new Date('2026-05-15');

    it('puts balance into correct single bucket', () => {
      const buckets = allocateToAgedBuckets(BigInt(250000), '2026-05-01', asOf); // ~14 days overdue
      expect(buckets.days1_30).toBe(BigInt(250000));
      expect(buckets.current).toBe(BigInt(0));
      expect(buckets.days31_60).toBe(BigInt(0));
      expect(buckets.days61_90).toBe(BigInt(0));
      expect(buckets.days90plus).toBe(BigInt(0));
    });
  });

  describe('validateMethodDetails', () => {
    it('validates cash (can be empty)', () => {
      expect(() => validateMethodDetails('cash', {})).not.toThrow();
      expect(() => validateMethodDetails('cash', null)).not.toThrow();
    });

    it('validates bank_transfer requires bank_reference', () => {
      expect(() => validateMethodDetails('bank_transfer', {})).toThrow();
      expect(() =>
        validateMethodDetails('bank_transfer', { bank_reference: 'TXN-9988' }),
      ).not.toThrow();
    });

    it('validates cheque requires cheque_number, bank, and YYYY-MM-DD date', () => {
      expect(() =>
        validateMethodDetails('cheque', {
          cheque_number: '123456',
          bank: 'Standard Bank',
          cheque_date: '2026-06-01',
        }),
      ).not.toThrow();

      expect(() =>
        validateMethodDetails('cheque', {
          cheque_number: '123456',
          bank: 'Standard Bank',
          cheque_date: '01/06/2026',
        }),
      ).toThrow();
    });

    it('validates card requires uuid terminal_id, approval_code, slip_number', () => {
      expect(() =>
        validateMethodDetails('card', {
          terminal_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          approval_code: 'APPR-123',
          slip_number: 'SLIP-456',
        }),
      ).not.toThrow();

      expect(() =>
        validateMethodDetails('card', {
          terminal_id: 'not-a-uuid',
          approval_code: 'APPR-123',
          slip_number: 'SLIP-456',
        }),
      ).toThrow();
    });

    it('validates mobile money (airtel_money, mpamba) requires transaction_id and sender_phone', () => {
      expect(() =>
        validateMethodDetails('airtel_money', {
          transaction_id: 'AIR-999',
          sender_phone: '+265991234567',
        }),
      ).not.toThrow();

      expect(() =>
        validateMethodDetails('mpamba', {
          transaction_id: 'MP-888',
          sender_phone: '+265881234567',
        }),
      ).not.toThrow();

      expect(() =>
        validateMethodDetails('airtel_money', {
          transaction_id: '',
          sender_phone: '+265991234567',
        }),
      ).toThrow();
    });
  });
});

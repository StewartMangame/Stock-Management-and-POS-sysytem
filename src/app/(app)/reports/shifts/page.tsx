import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/permissions';

export const metadata: Metadata = { title: 'POS Shifts' };

/**
 * Shifts report — redirects to the existing POS shifts management page which
 * already provides shift details, cash-up summary, and cashier variance.
 * This route exists so the Report Center can link to it consistently.
 */
export default async function ShiftsReportPage() {
  await authorize(PERMISSIONS.SHIFTS_MANAGE);
  redirect('/pos/shifts');
}


import { NextRequest, NextResponse } from 'next/server';
import { expireOutdatedReservations } from '@/server/services/sales/cron';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET environment variable is not configured' },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get('authorization');
  const customHeader = request.headers.get('x-cron-secret');

  const isBearerMatch = authHeader === `Bearer ${cronSecret}`;
  const isCustomMatch = customHeader === cronSecret;

  if (!isBearerMatch && !isCustomMatch) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await expireOutdatedReservations();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Error expiring stock reservations:', err);
    return NextResponse.json(
      { error: 'Failed to expire reservations', details: String(err) },
      { status: 500 },
    );
  }
}

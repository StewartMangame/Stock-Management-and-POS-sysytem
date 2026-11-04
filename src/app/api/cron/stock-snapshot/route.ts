import { NextResponse } from 'next/server';
import { runSnapshotCron } from '@/server/services/stock/snapshot-cron';

export async function GET(req: Request) {
  // Verify cron secret to prevent public triggering
  const authHeader = req.headers.get('authorization');

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runSnapshotCron();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron:stock-snapshot] error:', err);
    return NextResponse.json({ error: 'Snapshot cron failed', detail: String(err) }, { status: 500 });
  }
}


/**
 * POST /api/admin/statement-import/[importId]/match
 *   Body: { lineId: string; paymentIds: string[] }
 *   Matches a statement line to one or more payments.
 *
 * DELETE /api/admin/statement-import/[importId]/match
 *   Body: { lineId: string }
 *   Removes a manual match, resetting the line to unmatched.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  matchStatementLine,
  unmatchStatementLine,
} from '@/server/services/integrations/bank-reconciliation';

interface Props {
  params: Promise<{ importId: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await params; // importId available if needed for validation

  let body: { lineId?: string; paymentIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!body.lineId || !Array.isArray(body.paymentIds) || body.paymentIds.length === 0) {
    return NextResponse.json(
      { error: 'lineId and at least one paymentId are required.' },
      { status: 400 },
    );
  }

  try {
    const result = await matchStatementLine(body.lineId, body.paymentIds, session.user.id);
    return NextResponse.json({ success: true, match: result });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Failed to match statement line.' },
      { status: 422 },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await params;

  let body: { lineId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!body.lineId) {
    return NextResponse.json({ error: 'lineId is required.' }, { status: 400 });
  }

  try {
    await unmatchStatementLine(body.lineId, session.user.id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Failed to remove match.' },
      { status: 422 },
    );
  }
}


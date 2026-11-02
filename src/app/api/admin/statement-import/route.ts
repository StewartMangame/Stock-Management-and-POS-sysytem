/**
 * POST /api/admin/statement-import
 * Accepts a multipart CSV upload and imports it as a bank statement.
 * Protected — requires authenticated session (admin/manager role).
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { importStatementCsv } from '@/server/services/integrations/bank-reconciliation';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const profileId = formData.get('profileId') as string | null;

  if (!file) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }
  if (!profileId) {
    return NextResponse.json({ error: 'profileId is required.' }, { status: 400 });
  }

  const csvText = await file.text();

  try {
    const result = await importStatementCsv(csvText, {
      filename: file.name,
      profileId,
      userId: session.user.id,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Failed to import statement.' },
      { status: 422 },
    );
  }
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Return list of statement imports (most recent 50)
  const { db } = await import('@/server/db');
  const { statementImports } = await import('@/server/db/schema');
  const { desc } = await import('drizzle-orm');

  const imports = await db
    .select()
    .from(statementImports)
    .orderBy(desc(statementImports.importedAt))
    .limit(50);

  return NextResponse.json({ imports });
}


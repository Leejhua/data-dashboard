import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type IngestItem = {
  id?: string;
  title?: string;
  exposure?: string | number;
  visits?: string | number;
  amount?: string | number;
  price?: string;
  managed_days?: string | number;
  scope?: string;
  start_date?: string;
  end_date?: string;
  optimization?: string;
};

type IngestPayload = {
  date?: string;
  collectedAt?: string;
  source?: string;
  items?: IngestItem[];
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-zulin-token',
};

const jsonWithCors = (body: unknown, status: number) => {
  return NextResponse.json(body, {
    status,
    headers: corsHeaders,
  });
};

const toNumber = (value: unknown) => {
  const normalized = String(value ?? '').replace(/[,%\s]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toInt = (value: unknown) => {
  const parsed = parseInt(String(value ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toISODate = (value?: string) => {
  if (!value) return '';
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString().slice(0, 10);
  }
  const match = raw.match(/(\d{4})[^\d]?(\d{1,2})[^\d]?(\d{1,2})/);
  if (!match) return '';
  const y = match[1];
  const m = match[2].padStart(2, '0');
  const d = match[3].padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const createBatchId = () => {
  return `zulin_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

async function ensureTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS zulin_upload_batch (
      id TEXT PRIMARY KEY,
      source TEXT,
      payload_count INTEGER NOT NULL,
      inserted_count INTEGER NOT NULL,
      updated_count INTEGER NOT NULL,
      failed_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS zulin_daily_metrics (
      id TEXT PRIMARY KEY,
      data_date TEXT NOT NULL,
      product_id TEXT NOT NULL,
      title TEXT NOT NULL,
      exposure INTEGER NOT NULL DEFAULT 0,
      visits INTEGER NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      price TEXT,
      managed_days INTEGER NOT NULL DEFAULT 0,
      scope TEXT,
      start_date TEXT,
      end_date TEXT,
      optimization TEXT,
      source TEXT,
      batch_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(data_date, product_id)
    )
  `);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeaders,
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function POST(request: Request) {
  const token = process.env.ZULIN_INGEST_TOKEN || '';
  const requestToken = request.headers.get('x-zulin-token') || '';
  if (token && requestToken !== token) {
    return jsonWithCors({ error: 'Unauthorized' }, 401);
  }

  let payload: IngestPayload;
  try {
    payload = await request.json();
  } catch {
    return jsonWithCors({ error: 'Invalid JSON payload' }, 400);
  }

  const date = toISODate(payload.date);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!date) {
    return jsonWithCors({ error: 'Invalid date' }, 400);
  }
  if (!items.length) {
    return jsonWithCors({ error: 'No items to ingest' }, 400);
  }
  if (items.length > 5000) {
    return jsonWithCors({ error: 'Too many items in one request' }, 400);
  }

  await ensureTables();

  const now = new Date().toISOString();
  const batchId = createBatchId();
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  const failedItems: Array<{ productId: string; reason: string }> = [];

  for (const item of items) {
    const productId = String(item.id || '').replace(/\s+/g, '');
    const title = String(item.title || '').trim();
    if (!productId || !title) {
      failed += 1;
      failedItems.push({ productId: productId || '-', reason: '缺少商品ID或标题' });
      continue;
    }
    const rowId = `${date}:${productId}`;
    const exposure = toInt(item.exposure);
    const visits = toInt(item.visits);
    const amount = toNumber(item.amount);
    const managedDays = toInt(item.managed_days);
    const scope = String(item.scope || '').trim();
    const startDate = toISODate(String(item.start_date || '').trim());
    const endDate = toISODate(String(item.end_date || '').trim());
    const optimization = String(item.optimization || '').trim();
    const price = String(item.price || '').trim();
    const source = String(payload.source || 'extension').trim() || 'extension';

    const existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM zulin_daily_metrics WHERE data_date = ${date} AND product_id = ${productId} LIMIT 1
    `;
    const wasExisting = existing.length > 0;

    await prisma.$executeRaw`
      INSERT INTO zulin_daily_metrics (
        id, data_date, product_id, title, exposure, visits, amount, price,
        managed_days, scope, start_date, end_date, optimization, source,
        batch_id, created_at, updated_at
      )
      VALUES (${rowId}, ${date}, ${productId}, ${title}, ${exposure}, ${visits}, ${amount}, ${price}, ${managedDays}, ${scope}, ${startDate || null}, ${endDate || null}, ${optimization}, ${source}, ${batchId}, ${now}, ${now})
      ON CONFLICT(data_date, product_id) DO UPDATE SET
        title = excluded.title,
        exposure = excluded.exposure,
        visits = excluded.visits,
        amount = excluded.amount,
        price = excluded.price,
        managed_days = excluded.managed_days,
        scope = excluded.scope,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        optimization = excluded.optimization,
        source = excluded.source,
        batch_id = excluded.batch_id,
        updated_at = excluded.updated_at
    `;

    if (wasExisting) {
      updated += 1;
    } else {
      inserted += 1;
    }
  }

  await prisma.$executeRaw`
    INSERT INTO zulin_upload_batch (
      id, source, payload_count, inserted_count, updated_count, failed_count, created_at
    )
    VALUES (${batchId}, ${String(payload.source || 'extension') || 'extension'}, ${items.length}, ${inserted}, ${updated}, ${failed}, ${now})
  `;

  return NextResponse.json(
    {
      batchId,
      date,
      payloadCount: items.length,
      insertedCount: inserted,
      updatedCount: updated,
      failedCount: failed,
      failedItems: failedItems.slice(0, 20),
    },
    {
      headers: corsHeaders,
    }
  );
}

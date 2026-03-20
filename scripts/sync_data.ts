import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DOMAIN = 'https://order.speedstarsunblocked.online';
const TOKEN = '01741e69d637f27db95664561dad0cd76a37e0fa37b2cfbb4d5f38c1fecc9999';

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json'
};

interface SyncPage<T> {
  data: T[];
}

interface ProductMappingItem {
  name?: string;
  productName?: string;
  matchKeywords?: unknown;
  keywords?: unknown;
  aliases?: unknown;
  variants?: unknown;
}

interface SyncOnlineItem {
  orderNo: string;
  platform?: string | null;
  status?: string | null;
  merchantName?: string | null;
  productName?: string | null;
  variantName?: string | null;
  itemTitle?: string | null;
  itemSku?: string | null;
  totalAmount?: number | string | null;
  rentPrice?: number | string | null;
  deposit?: number | string | null;
  insurancePrice?: number | string | null;
  duration?: number | string | null;
  promotionChannel?: string | null;
  source?: string | null;
  customerName?: string | null;
  recipientPhone?: string | null;
  address?: string | null;
  logisticsCompany?: string | null;
  trackingNumber?: string | null;
  latestLogisticsInfo?: string | null;
  returnLogisticsCompany?: string | null;
  returnTrackingNumber?: string | null;
  returnLatestLogisticsInfo?: string | null;
  rentStartDate?: string | null;
  returnDeadline?: string | null;
  manualSn?: string | null;
  specId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface SyncOfflineItem {
  orderNo: string;
  source?: string | null;
  platform?: string | null;
  status?: string | null;
  customerXianyuId?: string | null;
  sourceContact?: string | null;
  productName?: string | null;
  variantName?: string | null;
  sn?: string | null;
  duration?: number | string | null;
  rentPrice?: number | string | null;
  deposit?: number | string | null;
  insurancePrice?: number | string | null;
  overdueFee?: number | string | null;
  totalAmount?: number | string | null;
  address?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  logisticsCompany?: string | null;
  trackingNumber?: string | null;
  latestLogisticsInfo?: string | null;
  returnLogisticsCompany?: string | null;
  returnTrackingNumber?: string | null;
  returnLatestLogisticsInfo?: string | null;
  rentStartDate?: string | null;
  returnDeadline?: string | null;
  deliveryTime?: string | null;
  actualDeliveryTime?: string | null;
  completedAt?: string | null;
  remark?: string | null;
  specId?: string | null;
  creatorName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface SpecRef {
  id: string;
  productId: string;
}

interface ProductRule {
  id: string;
  name: string;
  keywords: string[];
}

async function fetchWithRetry(url: string, retries = 3): Promise<unknown> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(res => setTimeout(res, 1000 * (i + 1))); // exponential backoff
    }
  }
}

function normalizeKeywords(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map(item => String(item).trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(item => String(item).trim()).filter(Boolean);
      }
    } catch {
    }
    return trimmed
      .split(/[,\n，;；|]/)
      .map(item => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeText(input: string | null | undefined): string {
  return String(input || '').trim();
}

function toCompactUpper(input: string | null | undefined): string {
  return normalizeText(input)
    .toUpperCase()
    .replace(/\[[^\]]*]/g, '')
    .replace(/【[^】]*】/g, '')
    .replace(/\s+/g, '');
}

async function getOrCreateProductId(name: string | null | undefined, productIdByName: Map<string, string>): Promise<string> {
  const normalizedName = normalizeText(name) || '未分类商品';
  const cachedId = productIdByName.get(normalizedName);
  if (cachedId) return cachedId;

  const existing = await prisma.product.findFirst({
    where: { name: normalizedName },
    select: { id: true }
  });

  if (existing) {
    productIdByName.set(normalizedName, existing.id);
    return existing.id;
  }

  const created = await prisma.product.create({
    data: {
      name: normalizedName,
      variants: '[]',
      matchKeywords: JSON.stringify([normalizedName])
    },
    select: { id: true }
  });

  productIdByName.set(normalizedName, created.id);
  return created.id;
}

async function loadProductRules(productIdByName: Map<string, string>): Promise<ProductRule[]> {
  const products = await prisma.product.findMany({
    select: { id: true, name: true, matchKeywords: true }
  });

  return products.map(item => {
    productIdByName.set(item.name, item.id);
    let keywords: string[] = [];
    if (item.matchKeywords) {
      try {
        const parsed = JSON.parse(item.matchKeywords);
        if (Array.isArray(parsed)) {
          keywords = parsed.map(k => String(k).trim()).filter(Boolean);
        }
      } catch {
        keywords = [];
      }
    }
    if (keywords.length === 0) {
      keywords = [item.name];
    }
    return {
      id: item.id,
      name: item.name,
      keywords
    };
  });
}

function resolveProductIdByTitle(
  productRules: ProductRule[],
  productName: string | null | undefined,
  variantName?: string | null,
  itemTitle?: string | null
): string | null {
  const candidateText = [productName, variantName, itemTitle].map(toCompactUpper).join(' ');
  if (!candidateText.trim()) return null;

  for (const rule of productRules) {
    const matched = rule.keywords.some(keyword => {
      const compactKeyword = toCompactUpper(keyword);
      return compactKeyword && candidateText.includes(compactKeyword);
    });
    if (matched) return rule.id;
  }
  return null;
}

async function resolveSpecRef(
  externalSpecId: string | null | undefined,
  productName: string | null | undefined,
  variantName: string | null | undefined,
  specRefByExternalId: Map<string, SpecRef>,
  productIdByName: Map<string, string>
): Promise<SpecRef | null> {
  const normalizedExternalSpecId = normalizeText(externalSpecId);
  if (!normalizedExternalSpecId) return null;

  const cached = specRefByExternalId.get(normalizedExternalSpecId);
  if (cached) return cached;

  const existingSpec = await prisma.productSpec.findUnique({
    where: { specId: normalizedExternalSpecId },
    select: { id: true, productId: true }
  });

  if (existingSpec) {
    const resolved = { id: existingSpec.id, productId: existingSpec.productId };
    specRefByExternalId.set(normalizedExternalSpecId, resolved);
    return resolved;
  }

  const productId = await getOrCreateProductId(productName, productIdByName);
  const specName = normalizeText(variantName) || normalizeText(productName) || normalizedExternalSpecId;

  try {
    const createdSpec = await prisma.productSpec.create({
      data: {
        specId: normalizedExternalSpecId,
        name: specName,
        accessories: '[]',
        insurancePrice: 0,
        priceRules: '[]',
        productId
      },
      select: { id: true, productId: true }
    });
    const resolved = { id: createdSpec.id, productId: createdSpec.productId };
    specRefByExternalId.set(normalizedExternalSpecId, resolved);
    return resolved;
  } catch {
    const latestSpec = await prisma.productSpec.findUnique({
      where: { specId: normalizedExternalSpecId },
      select: { id: true, productId: true }
    });
    if (!latestSpec) return null;
    const resolved = { id: latestSpec.id, productId: latestSpec.productId };
    specRefByExternalId.set(normalizedExternalSpecId, resolved);
    return resolved;
  }
}

async function syncProductMappings() {
  console.log('--- Starting Product Mapping Sync ---');
  let page = 1;
  let hasMore = true;
  let totalProcessed = 0;

  while (hasMore) {
    let data: unknown;
    try {
      data = await fetchWithRetry(`${DOMAIN}/api/products?page=${page}&pageSize=100`, 1);
    } catch (err) {
      if (page === 1) {
        console.log('--- Product mapping endpoint not available, skipping ---');
        return;
      }
      throw err;
    }

    const pageData = (data && typeof data === 'object' ? data : null) as SyncPage<ProductMappingItem> | null;
    if (!pageData || !Array.isArray(pageData.data) || pageData.data.length === 0) {
      hasMore = false;
      break;
    }

    const items = pageData.data;
    for (const item of items) {
      const name = String(item.name || item.productName || '').trim();
      if (!name) continue;

      const keywordList = normalizeKeywords(item.matchKeywords ?? item.keywords ?? item.aliases);
      const matchKeywords = keywordList.length > 0 ? JSON.stringify(keywordList) : null;

      const variantsInput = item.variants;
      const variants =
        typeof variantsInput === 'string'
          ? variantsInput
          : JSON.stringify(Array.isArray(variantsInput) ? variantsInput : []);

      const existing = await prisma.product.findFirst({ where: { name } });
      if (existing) {
        await prisma.product.update({
          where: { id: existing.id },
          data: {
            variants,
            matchKeywords
          }
        });
      } else {
        await prisma.product.create({
          data: {
            name,
            variants,
            matchKeywords
          }
        });
      }
      totalProcessed++;
    }

    if (items.length < 100) {
      hasMore = false;
    } else {
      page++;
    }
  }

  console.log(`--- Completed Product Mapping Sync. Total processed: ${totalProcessed} ---`);
}

async function syncOnlineOrders() {
  console.log('--- Starting Online Orders Sync ---');
  let page = 1;
  let hasMore = true;
  let totalProcessed = 0;
  const specRefByExternalId = new Map<string, SpecRef>();
  const productIdByName = new Map<string, string>();
  const productRules = await loadProductRules(productIdByName);

  while (hasMore) {
    console.log(`Fetching Online Orders Page ${page}...`);
    const data = await fetchWithRetry(`${DOMAIN}/api/online-orders?page=${page}&pageSize=100`) as SyncPage<SyncOnlineItem> | null;
    
    if (!data || !data.data || data.data.length === 0) {
      hasMore = false;
      break;
    }

    const items = data.data;
    
    for (const item of items) {
      const specRef = await resolveSpecRef(item.specId, item.productName, item.variantName, specRefByExternalId, productIdByName);
      const productIdFromTitle = resolveProductIdByTitle(productRules, item.productName, item.variantName, item.itemTitle);
      const finalProductId = specRef?.productId || productIdFromTitle || null;
      // Clean up fields to match prisma schema
      const orderData = {
        orderNo: item.orderNo,
        platform: item.platform || 'UNKNOWN',
        status: item.status || 'UNKNOWN',
        merchantName: item.merchantName,
        productName: item.productName,
        variantName: item.variantName,
        itemTitle: item.itemTitle,
        itemSku: item.itemSku,
        totalAmount: item.totalAmount ? Number(item.totalAmount) : null,
        rentPrice: item.rentPrice ? Number(item.rentPrice) : null,
        deposit: item.deposit ? Number(item.deposit) : null,
        insurancePrice: item.insurancePrice ? Number(item.insurancePrice) : null,
        duration: item.duration ? Number(item.duration) : null,
        promotionChannel: item.promotionChannel,
        source: item.source,
        customerName: item.customerName,
        recipientPhone: item.recipientPhone,
        address: item.address,
        logisticsCompany: item.logisticsCompany,
        trackingNumber: item.trackingNumber,
        latestLogisticsInfo: item.latestLogisticsInfo,
        returnLogisticsCompany: item.returnLogisticsCompany,
        returnTrackingNumber: item.returnTrackingNumber,
        returnLatestLogisticsInfo: item.returnLatestLogisticsInfo,
        rentStartDate: item.rentStartDate ? new Date(item.rentStartDate) : null,
        returnDeadline: item.returnDeadline ? new Date(item.returnDeadline) : null,
        manualSn: item.manualSn,
        productId: finalProductId,
        specId: specRef?.id || null,
        createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
        updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date()
      };

      try {
        await prisma.onlineOrder.upsert({
          where: { orderNo: item.orderNo },
          update: orderData,
          create: orderData
        });
        totalProcessed++;
      } catch (err) {
        console.error(`Error saving online order ${item.orderNo}:`, err);
      }
    }

    if (items.length < 100) {
      hasMore = false; // Last page
    } else {
      page++;
    }
  }
  console.log(`--- Completed Online Orders Sync. Total processed: ${totalProcessed} ---`);
}

async function syncOfflineOrders() {
  console.log('--- Starting Offline Orders Sync ---');
  let page = 1;
  let hasMore = true;
  let totalProcessed = 0;
  const specRefByExternalId = new Map<string, SpecRef>();
  const productIdByName = new Map<string, string>();
  const productRules = await loadProductRules(productIdByName);

  while (hasMore) {
    console.log(`Fetching Offline Orders Page ${page}...`);
    const data = await fetchWithRetry(`${DOMAIN}/api/orders?page=${page}&pageSize=100`) as SyncPage<SyncOfflineItem> | null;
    
    if (!data || !data.data || data.data.length === 0) {
      hasMore = false;
      break;
    }

    const items = data.data;
    
    for (const item of items) {
      const specRef = await resolveSpecRef(item.specId, item.productName, item.variantName, specRefByExternalId, productIdByName);
      const productIdFromTitle = resolveProductIdByTitle(productRules, item.productName, item.variantName);
      const finalProductId = specRef?.productId || productIdFromTitle || null;
      const orderData = {
        orderNo: item.orderNo,
        source: item.source || 'UNKNOWN',
        platform: item.platform,
        status: item.status || 'UNKNOWN',
        customerXianyuId: item.customerXianyuId || 'UNKNOWN',
        sourceContact: item.sourceContact || 'UNKNOWN',
        productName: item.productName || 'UNKNOWN',
        variantName: item.variantName || 'UNKNOWN',
        sn: item.sn,
        duration: item.duration ? Number(item.duration) : 0,
        rentPrice: item.rentPrice ? Number(item.rentPrice) : 0,
        deposit: item.deposit ? Number(item.deposit) : 0,
        insurancePrice: item.insurancePrice ? Number(item.insurancePrice) : 0,
        overdueFee: item.overdueFee ? Number(item.overdueFee) : null,
        totalAmount: item.totalAmount ? Number(item.totalAmount) : 0,
        address: item.address || 'UNKNOWN',
        recipientName: item.recipientName,
        recipientPhone: item.recipientPhone,
        logisticsCompany: item.logisticsCompany,
        trackingNumber: item.trackingNumber,
        latestLogisticsInfo: item.latestLogisticsInfo,
        returnLogisticsCompany: item.returnLogisticsCompany,
        returnTrackingNumber: item.returnTrackingNumber,
        returnLatestLogisticsInfo: item.returnLatestLogisticsInfo,
        rentStartDate: item.rentStartDate ? new Date(item.rentStartDate) : null,
        returnDeadline: item.returnDeadline ? new Date(item.returnDeadline) : null,
        deliveryTime: item.deliveryTime ? new Date(item.deliveryTime) : null,
        actualDeliveryTime: item.actualDeliveryTime ? new Date(item.actualDeliveryTime) : null,
        completedAt: item.completedAt ? new Date(item.completedAt) : null,
        remark: item.remark,
        productId: finalProductId,
        specId: specRef?.id || null,
        creatorName: item.creatorName || 'System',
        creatorId: 'system', // Default creator id
        createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
        updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date()
      };

      try {
        await prisma.order.upsert({
          where: { orderNo: item.orderNo },
          update: orderData,
          create: orderData
        });
        totalProcessed++;
      } catch (err) {
        console.error(`Error saving offline order ${item.orderNo}:`, err);
      }
    }

    if (items.length < 100) {
      hasMore = false; // Last page
    } else {
      page++;
    }
  }
  console.log(`--- Completed Offline Orders Sync. Total processed: ${totalProcessed} ---`);
}

async function main() {
  try {
    await syncProductMappings();
    await syncOnlineOrders();
    await syncOfflineOrders();
  } catch (e) {
    console.error('Fatal error during sync:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();

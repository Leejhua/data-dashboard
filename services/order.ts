import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export interface GetOrdersParams {
  page?: number;
  pageSize?: number;
  status?: string;
  orderNo?: string;
  startDate?: string;
  endDate?: string;
  platform?: string;
}

interface ProductMappingProduct {
  id: string;
  name: string;
}

interface ProductMappingSpec {
  id: string;
  specId: string;
  name: string;
  productId: string;
  productName: string;
  offlineOrderCount: number;
  onlineOrderCount: number;
  totalOrderCount: number;
}

interface UpdateProductMappingParams {
  productSpecId: string;
  productId: string;
}

const ITEM_TYPE_MAPPING_CONFIG_KEY = 'INVENTORY_ITEM_TYPE_PRODUCT_NAME_MAPPINGS';

export class OrderService {
  private static normalizeKeywords(raw: unknown): string[] {
    if (Array.isArray(raw)) {
      return Array.from(new Set(raw.map((entry) => String(entry).trim()).filter(Boolean)));
    }
    if (typeof raw === 'string') {
      const text = raw.trim();
      if (!text) return [];
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          return Array.from(new Set(parsed.map((entry) => String(entry).trim()).filter(Boolean)));
        }
      } catch {
      }
    }
    return [];
  }

  private static parseItemTypeKeywordMap(rawValue: string | null | undefined): Record<string, string[]> {
    if (!rawValue) return {};
    try {
      const parsed = JSON.parse(rawValue);
      if (!parsed || typeof parsed !== 'object') return {};
      const entries = Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, this.normalizeKeywords(value)] as const);
      return Object.fromEntries(entries);
    } catch {
      return {};
    }
  }

  /**
   * Helper to build where clause
   */
  private static buildWhere(params: GetOrdersParams): Prisma.OrderWhereInput {
    const { status, orderNo, platform, startDate, endDate } = params;
    const where: Prisma.OrderWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (orderNo) {
      where.orderNo = {
        contains: orderNo,
      };
    }

    if (platform) {
      where.platform = platform;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        // Add 1 day to include the end date fully (up to 23:59:59.999)
        // Or assume endDate is already adjusted. 
        // Standard practice: if endDate is '2023-01-01', we want < '2023-01-02'
        const end = new Date(endDate);
        end.setDate(end.getDate() + 1);
        where.createdAt.lt = end;
      }
    }
    return where;
  }

  static async getOrders(params: GetOrdersParams) {
    const {
      page = 1,
      pageSize = 10,
    } = params;

    const skip = (page - 1) * pageSize;
    const where = this.buildWhere(params);
    const orderListSelect = {
      id: true,
      orderNo: true,
      platform: true,
      status: true,
      totalAmount: true,
      productName: true,
      createdAt: true,
      recipientName: true,
      recipientPhone: true,
      address: true,
      trackingNumber: true,
      promoter: {
        select: {
          name: true,
        },
      },
      channel: {
        select: {
          name: true,
        },
      },
    } as const;

    // Execute query in transaction to get data and count
    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: {
          createdAt: 'desc',
        },
        select: orderListSelect,
      }),
      prisma.order.count({ where }),
    ]);

    return {
      data: orders,
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }
  
  static async getAllOrdersForExport(params: GetOrdersParams) {
    const where = this.buildWhere(params);
    const exportSelect = {
      id: true,
      orderNo: true,
      platform: true,
      status: true,
      totalAmount: true,
      productName: true,
      createdAt: true,
      recipientName: true,
      recipientPhone: true,
      address: true,
      trackingNumber: true,
      promoter: {
        select: {
          name: true,
        },
      },
      channel: {
        select: {
          name: true,
        },
      },
    } as const;
    
    return prisma.order.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      select: exportSelect,
    });
  }

  static async getOnlineOrders(params: GetOrdersParams) {
    const {
      page = 1,
      pageSize = 10,
    } = params;

    const skip = (page - 1) * pageSize;
    // Reuse buildWhere logic but type is different
    // Fortunately, OnlineOrder has similar fields (status, orderNo, platform, createdAt)
    const where: Prisma.OnlineOrderWhereInput = this.buildWhere(params) as Prisma.OnlineOrderWhereInput;

    // Special handling for '支付宝小程序' which is a promotionChannel, not a platform
    if (params.platform === '支付宝小程序') {
      delete where.platform;
      where.promotionChannel = {
        contains: '支付宝小程序'
      };
    }
    const onlineListSelect = {
      id: true,
      orderNo: true,
      platform: true,
      status: true,
      totalAmount: true,
      productName: true,
      createdAt: true,
      customerName: true,
      recipientPhone: true,
      address: true,
      trackingNumber: true,
      logisticsCompany: true,
      merchantName: true,
      itemSku: true,
      promotionChannel: true,
    } as const;

    const [orders, total] = await prisma.$transaction([
      prisma.onlineOrder.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: {
          createdAt: 'desc',
        },
        select: onlineListSelect,
      }),
      prisma.onlineOrder.count({ where }),
    ]);

    return {
      data: orders.map((order) => ({
        ...order,
        recipientName: order.customerName || null,
      })),
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  static async getProductMappingData() {
    const [products, specs, offlineOrders, onlineOrders] = await prisma.$transaction([
      prisma.product.findMany({
        select: {
          id: true,
          name: true,
        },
        orderBy: { name: 'asc' },
      }),
      prisma.productSpec.findMany({
        select: {
          id: true,
          specId: true,
          name: true,
          productId: true,
          product: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.order.findMany({
        select: { specId: true },
        where: {
          AND: [
            { specId: { not: null } },
            { specId: { not: '' } },
          ],
        },
      }),
      prisma.onlineOrder.findMany({
        select: { specId: true },
        where: {
          AND: [
            { specId: { not: null } },
            { specId: { not: '' } },
          ],
        },
      }),
    ]);

    const offlineCounter = new Map<string, number>();
    offlineOrders.forEach((item) => {
      const key = String(item.specId || '').trim();
      if (!key) return;
      offlineCounter.set(key, (offlineCounter.get(key) || 0) + 1);
    });

    const onlineCounter = new Map<string, number>();
    onlineOrders.forEach((item) => {
      const key = String(item.specId || '').trim();
      if (!key) return;
      onlineCounter.set(key, (onlineCounter.get(key) || 0) + 1);
    });

    const productList: ProductMappingProduct[] = products.map((item) => ({
      id: item.id,
      name: item.name,
    }));

    const specList: ProductMappingSpec[] = specs.map((item) => {
      const offlineOrderCount = offlineCounter.get(item.id) || 0;
      const onlineOrderCount = onlineCounter.get(item.id) || 0;
      return {
        id: item.id,
        specId: item.specId,
        name: item.name,
        productId: item.productId,
        productName: item.product.name,
        offlineOrderCount,
        onlineOrderCount,
        totalOrderCount: offlineOrderCount + onlineOrderCount,
      };
    });

    return {
      products: productList,
      specs: specList,
    };
  }

  static async updateProductMapping(params: UpdateProductMappingParams) {
    const { productSpecId, productId } = params;
    const normalizedSpecId = String(productSpecId || '').trim();
    const normalizedProductId = String(productId || '').trim();

    if (!normalizedSpecId || !normalizedProductId) {
      throw new Error('MAPPING_PARAMS_REQUIRED');
    }

    return prisma.$transaction(async (tx) => {
      const spec = await tx.productSpec.findUnique({
        where: { id: normalizedSpecId },
        select: { id: true },
      });

      if (!spec) {
        throw new Error('SPEC_NOT_FOUND');
      }

      const product = await tx.product.findUnique({
        where: { id: normalizedProductId },
        select: { id: true },
      });

      if (!product) {
        throw new Error('PRODUCT_NOT_FOUND');
      }

      const updatedSpec = await tx.productSpec.update({
        where: { id: normalizedSpecId },
        data: { productId: normalizedProductId },
        select: {
          id: true,
          specId: true,
          name: true,
          productId: true,
          product: {
            select: {
              name: true,
            },
          },
        },
      });

      const [offlineSyncResult, onlineSyncResult] = await Promise.all([
        tx.order.updateMany({
          where: { specId: normalizedSpecId },
          data: { productId: normalizedProductId },
        }),
        tx.onlineOrder.updateMany({
          where: { specId: normalizedSpecId },
          data: { productId: normalizedProductId },
        }),
      ]);

      return {
        id: updatedSpec.id,
        specId: updatedSpec.specId,
        name: updatedSpec.name,
        productId: updatedSpec.productId,
        productName: updatedSpec.product.name,
        syncedOfflineOrders: offlineSyncResult.count,
        syncedOnlineOrders: onlineSyncResult.count,
      };
    });
  }

  static async updateProductKeywords(itemTypeId: string, keywords: string[]) {
    const itemType = await prisma.inventoryItemType.findUnique({
      where: { id: itemTypeId },
      select: { id: true, name: true },
    });

    if (!itemType) {
      throw new Error('ITEM_TYPE_NOT_FOUND');
    }

    const normalizedKeywords = Array.from(new Set(keywords.map((item) => String(item).trim()).filter(Boolean)));

    if (!normalizedKeywords.includes(itemType.name)) {
      normalizedKeywords.unshift(itemType.name);
    }

    const config = await prisma.appConfig.findUnique({
      where: { key: ITEM_TYPE_MAPPING_CONFIG_KEY },
      select: { value: true },
    });
    const itemTypeKeywordMap = this.parseItemTypeKeywordMap(config?.value);
    itemTypeKeywordMap[itemTypeId] = normalizedKeywords;
    const serializedMap = JSON.stringify(itemTypeKeywordMap);

    await prisma.appConfig.upsert({
      where: { key: ITEM_TYPE_MAPPING_CONFIG_KEY },
      update: { value: serializedMap },
      create: { key: ITEM_TYPE_MAPPING_CONFIG_KEY, value: serializedMap },
    });

    return {
      id: itemType.id,
      name: itemType.name,
      matchKeywords: JSON.stringify(normalizedKeywords),
    };
  }
}

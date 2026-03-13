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

export class OrderService {
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

    // Execute query in transaction to get data and count
    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
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
        },
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
    
    return prisma.order.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
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
      },
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

    const [orders, total] = await prisma.$transaction([
      prisma.onlineOrder.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: {
          createdAt: 'desc',
        },
      }),
      prisma.onlineOrder.count({ where }),
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
}

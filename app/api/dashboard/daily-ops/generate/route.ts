import { NextResponse } from 'next/server';
import { DashboardService } from '@/services/dashboard';
import { prisma } from '@/lib/prisma';

export async function POST() {
  try {
    const today = new Date();
    const dateKey = today.toISOString().slice(0, 10);

    // 获取运营数据
    const now = new Date();
    const currentStart = new Date(now);
    currentStart.setDate(now.getDate() - 7);
    currentStart.setHours(0, 0, 0, 0);
    const previousStart = new Date(currentStart);
    previousStart.setDate(currentStart.getDate() - 7);

    const [offlineOrders, onlineOrders] = await Promise.all([
      prisma.order.findMany({
        where: {
          createdAt: { gte: previousStart, lt: now },
          status: { in: DashboardService.VALID_STATUSES },
        },
        select: { createdAt: true, platform: true, totalAmount: true },
      }),
      prisma.onlineOrder.findMany({
        where: {
          createdAt: { gte: previousStart, lt: now },
          status: { in: DashboardService.VALID_STATUSES },
        },
        select: { createdAt: true, platform: true, promotionChannel: true, totalAmount: true },
      }),
    ]);

    const currentByPlatform = new Map<string, { gmv: number; orders: number }>();
    const previousByPlatform = new Map<string, { gmv: number; orders: number }>();

    const appendMetric = (target: Map<string, { gmv: number; orders: number }>, platform: string, amount: number) => {
      const existing = target.get(platform) || { gmv: 0, orders: 0 };
      existing.gmv += amount;
      existing.orders += 1;
      target.set(platform, existing);
    };

    const collect = (createdAt: Date, platform: string, amount: number) => {
      const normalizedPlatform = DashboardService.normalizePlatform(platform);
      const target = createdAt >= currentStart ? currentByPlatform : previousByPlatform;
      appendMetric(target, normalizedPlatform, amount);
    };

    offlineOrders.forEach((item) => collect(item.createdAt, item.platform || '', item.totalAmount || 0));
    onlineOrders.forEach((item) => {
      const platform = DashboardService.normalizePlatform(item.platform, item.promotionChannel);
      const target = item.createdAt >= currentStart ? currentByPlatform : previousByPlatform;
      appendMetric(target, platform, item.totalAmount || 0);
    });

    const currentControllable = { gmv: 0, orders: 0, aov: 0 };
    const previousControllable = { gmv: 0, orders: 0, aov: 0 };
    const currentAll = { gmv: 0, orders: 0, aov: 0 };
    const previousAll = { gmv: 0, orders: 0, aov: 0 };

    for (const [platform, data] of currentByPlatform) {
      currentAll.gmv += data.gmv;
      currentAll.orders += data.orders;
      if (DashboardService.CONTROLLABLE_PLATFORMS.includes(platform)) {
        currentControllable.gmv += data.gmv;
        currentControllable.orders += data.orders;
      }
    }

    for (const [platform, data] of previousByPlatform) {
      previousAll.gmv += data.gmv;
      previousAll.orders += data.orders;
      if (DashboardService.CONTROLLABLE_PLATFORMS.includes(platform)) {
        previousControllable.gmv += data.gmv;
        previousControllable.orders += data.orders;
      }
    }

    currentControllable.aov = currentControllable.orders > 0 ? currentControllable.gmv / currentControllable.orders : 0;
    previousControllable.aov = previousControllable.orders > 0 ? previousControllable.gmv / previousControllable.orders : 0;
    currentAll.aov = currentAll.orders > 0 ? currentAll.gmv / currentAll.orders : 0;
    previousAll.aov = previousAll.orders > 0 ? previousAll.gmv / previousAll.orders : 0;

    const currentShare = currentAll.gmv > 0 ? (currentControllable.gmv / currentAll.gmv) * 100 : 0;
    const previousShare = previousAll.gmv > 0 ? (previousControllable.gmv / previousAll.gmv) * 100 : 0;
    const shareChange = currentShare - previousShare;

    const growth = (curr: number, prev: number) => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return ((curr - prev) / prev) * 100;
    };

    const zulinSnapshot = await DashboardService.getZulinOpsSnapshot(currentStart, previousStart, now);

    const fallbackCards: Array<{
      id: string;
      title: string;
      level: 'high' | 'medium' | 'low';
      tag: '可执行' | '观察项';
      scope: 'controllable' | 'all';
      insight: string;
      action: string;
      metric: { unit: '¥' | '单' | '%'; current: number; previous: number; changeRate: number };
    }> = [];

    const controllableGmvGrowth = growth(currentControllable.gmv, previousControllable.gmv);

    if (currentControllable.gmv < previousControllable.gmv * 0.5 && previousControllable.gmv > 0) {
      fallbackCards.push({
        id: 'controllable-gmv-down',
        title: '可控渠道 GMV 下滑',
        level: 'high',
        tag: '可执行',
        scope: 'controllable',
        insight: `近7天可控渠道 GMV 环比 ${controllableGmvGrowth.toFixed(1)}%`,
        action: '优先检查闲鱼',
        metric: { unit: '¥', current: currentControllable.gmv, previous: previousControllable.gmv, changeRate: controllableGmvGrowth },
      });
    }

    if (shareChange <= -3) {
      fallbackCards.push({
        id: 'controllable-share-down',
        title: '可控渠道占比下降',
        level: 'medium',
        tag: '观察项',
        scope: 'all',
        insight: `当前可控渠道 GMV 占比 ${currentShare.toFixed(1)}%，较上期 ${shareChange >= 0 ? '+' : ''}${shareChange.toFixed(1)}pct`,
        action: '将可控渠道占比作为周目标，稳定提升可控盘在全盘中的权重',
        metric: { unit: '%', current: currentShare, previous: previousShare, changeRate: shareChange },
      });
    }

    const platformMetrics = DashboardService.CONTROLLABLE_PLATFORMS.map((name) => {
      const current = currentByPlatform.get(name) || { gmv: 0, orders: 0 };
      const previous = previousByPlatform.get(name) || { gmv: 0, orders: 0 };
      return {
        name,
        currentGmv: current.gmv,
        previousGmv: previous.gmv,
        currentOrders: current.orders,
        previousOrders: previous.orders,
        gmvGrowth: growth(current.gmv, previous.gmv),
      };
    });

    // 调用 LLM 生成卡片
    const llmResult = await DashboardService.generateDailyOpsCardsWithLlm({
      now: now.toISOString(),
      summary: {
        currentAll,
        previousAll,
        currentControllable,
        previousControllable,
        currentShare,
        previousShare,
        shareChange,
      },
      platform: platformMetrics,
      zulinSnapshot,
      fallbackCards,
    });

    const finalCards = llmResult.cards && llmResult.cards.length ? llmResult.cards : fallbackCards;

    // 保存到缓存
    if (llmResult.status.used && finalCards.length > 0) {
      await DashboardService.saveDailyOpsCardCache(
        dateKey,
        finalCards,
        llmResult.status.model,
        'manual'
      );
    }

    return NextResponse.json({
      success: llmResult.status.used,
      date: dateKey,
      cards: finalCards.slice(0, DashboardService.DAILY_OPS_MAX_CARDS),
      status: llmResult.status,
    });
  } catch (error) {
    console.error('Generate DailyOps Cards Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate daily ops cards' },
      { status: 500 }
    );
  }
}

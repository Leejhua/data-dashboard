'use client';
import React, { useState } from 'react';
import { Card, Row, Col, Statistic, Radio, Space, theme, Breadcrumb } from 'antd';
import useSWR from 'swr';
import MainLayout from '../../components/MainLayout';
import PlatformTrendChart from '../../components/Charts/PlatformTrendChart';
import PlatformTrendGrid from '../../components/Charts/PlatformTrendGrid';
import type { PlatformTrendPoint, PlatformTrendTotal, PlatformTrendViewData } from '../../components/Charts/types';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || `Request failed: ${res.status}`);
  }
  return body;
};

const toNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const swrStableOptions = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  dedupingInterval: 60000,
};

interface PlatformTrendApiResponse {
  data: PlatformTrendPoint[];
  platforms: string[];
  totals?: Record<string, PlatformTrendTotal>;
}

interface DashboardSummaryData {
  totalGMV: number;
  totalOrders: number;
  activePromoters: number;
  recentGMV: number;
  recentOrders: number;
}

const OverviewPage: React.FC = () => {
  const [dimension, setDimension] = useState<'day' | 'week' | 'month'>('day');
  const [metric, setMetric] = useState<'gmv' | 'order'>('order');
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const { data: platformTrend, isLoading: isPlatformTrendLoading } = useSWR<PlatformTrendApiResponse>(
    `/api/dashboard/platform-trend?days=${dimension}`,
    fetcher,
    swrStableOptions
  );
  const { data: summary, isLoading: isSummaryLoading } = useSWR<DashboardSummaryData>(
    '/api/dashboard/summary',
    fetcher,
    swrStableOptions
  );

  const chartData = React.useMemo<PlatformTrendViewData>(() => {
    if (!platformTrend || !Array.isArray(platformTrend?.data) || !Array.isArray(platformTrend?.platforms)) {
      return { data: [], platforms: [], totals: {} };
    }

    const data = Array.isArray(platformTrend.data) ? platformTrend.data : [];
    const platforms = platformTrend.platforms.map((item) => String(item || '').trim()).filter(Boolean);
    const totals = (platformTrend.totals && typeof platformTrend.totals === 'object') ? platformTrend.totals : {};
    const newData: PlatformTrendPoint[] = data.map((item) => {
      const newItem: PlatformTrendPoint = { date: String(item?.date || '') };
      platforms.forEach((p: string) => {
        const value = metric === 'gmv' ? item[`${p}_gmv`] : item[`${p}_count`];
        newItem[p] = toNumber(value);
      });
      return newItem;
    });

    return { data: newData, platforms, totals: totals || {} };
  }, [platformTrend, metric]);

  return (
    <MainLayout>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Breadcrumb style={{ margin: '16px 0' }} items={[{ title: '数据看板' }, { title: '平台总览' }]} />
        <Space>
          <Radio.Group value={dimension} onChange={(e) => setDimension(e.target.value)} buttonStyle="solid">
            <Radio.Button value="day">日维度</Radio.Button>
            <Radio.Button value="week">周维度</Radio.Button>
            <Radio.Button value="month">月维度</Radio.Button>
          </Radio.Group>
          <Radio.Group value={metric} onChange={(e) => setMetric(e.target.value)} buttonStyle="solid">
            <Radio.Button value="order">订单量</Radio.Button>
            <Radio.Button value="gmv">销售额</Radio.Button>
          </Radio.Group>
        </Space>
      </div>

      <div style={{ padding: 24, minHeight: 360, background: colorBgContainer, borderRadius: borderRadiusLG }}>
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col xs={24} md={12} lg={6} style={{ display: 'flex' }}>
            <Card loading={isSummaryLoading} style={{ width: '100%' }} styles={{ body: { minHeight: 124 } }}>
              <Statistic title="累计 GMV" value={toNumber(summary?.totalGMV)} precision={2} prefix="¥" />
            </Card>
          </Col>
          <Col xs={24} md={12} lg={6} style={{ display: 'flex' }}>
            <Card loading={isSummaryLoading} style={{ width: '100%' }} styles={{ body: { minHeight: 124 } }}>
              <Statistic title="累计订单数" value={toNumber(summary?.totalOrders)} />
            </Card>
          </Col>
          <Col xs={24} md={12} lg={6} style={{ display: 'flex' }}>
            <Card loading={isSummaryLoading} style={{ width: '100%' }} styles={{ body: { minHeight: 124 } }}>
              <Statistic title="活跃推广员" value={toNumber(summary?.activePromoters)} />
            </Card>
          </Col>
          <Col xs={24} md={12} lg={6} style={{ display: 'flex' }}>
            <Card loading={isSummaryLoading} style={{ width: '100%' }} styles={{ body: { minHeight: 124 } }}>
              <Statistic title="近30天 GMV / 订单" value={`¥${toNumber(summary?.recentGMV).toFixed(2)} / ${toNumber(summary?.recentOrders)}`} />
            </Card>
          </Col>
        </Row>

        <Card title="各平台趋势" style={{ marginBottom: 24 }}>
          <PlatformTrendChart data={chartData} loading={isPlatformTrendLoading} />
        </Card>

        <PlatformTrendGrid data={chartData} loading={isPlatformTrendLoading} />
      </div>
    </MainLayout>
  );
};

export default OverviewPage;

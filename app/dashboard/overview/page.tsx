'use client';
import React, { useState } from 'react';
import { Card, Row, Col, Statistic, Radio, Space, theme, Breadcrumb, Tag, Button, Typography, Alert } from 'antd';
import useSWR from 'swr';
import { ReloadOutlined } from '@ant-design/icons';
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

const statCardBodyStyle = { minHeight: 116, padding: '16px 18px' };
const sectionCardTitleStyle: React.CSSProperties = { fontWeight: 600, fontSize: 14 };
const sectionCardStyles: { header: React.CSSProperties; body: React.CSSProperties } = {
  header: { padding: '12px 16px' },
  body: { padding: 16 },
};
const pageAlertStyle: React.CSSProperties = { marginBottom: 16 };
const trendCardLoadingStyles: { header: React.CSSProperties; body: React.CSSProperties } = {
  header: sectionCardStyles.header,
  body: { ...sectionCardStyles.body, minHeight: 432 },
};
const headerControlWrapStyle: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end', rowGap: 8 };

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

  const { data: platformTrend, isLoading: isPlatformTrendLoading, isValidating: isPlatformTrendValidating, mutate: refreshPlatformTrend, error: platformTrendError } = useSWR<PlatformTrendApiResponse>(
    `/api/dashboard/platform-trend?days=${dimension}`,
    fetcher,
    swrStableOptions
  );
  const { data: summary, isLoading: isSummaryLoading, isValidating: isSummaryValidating, mutate: refreshSummary, error: summaryError } = useSWR<DashboardSummaryData>(
    '/api/dashboard/summary',
    fetcher,
    swrStableOptions
  );
  const isRefreshing = isPlatformTrendValidating || isSummaryValidating;
  const lastUpdatedAt = React.useMemo(() => {
    if (!summary && !platformTrend) {
      return '';
    }
    return new Date().toLocaleString('zh-CN', { hour12: false });
  }, [summary, platformTrend]);

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

  const summaryCards = React.useMemo(() => {
    const recentOrders = toNumber(summary?.recentOrders);
    const recentGmv = toNumber(summary?.recentGMV);
    const recentAov = recentOrders > 0 ? recentGmv / recentOrders : 0;
    return [
      { title: '累计 GMV', value: toNumber(summary?.totalGMV), prefix: '¥', precision: 2 },
      { title: '累计订单数', value: toNumber(summary?.totalOrders), suffix: '单', precision: 0 },
      { title: '近30天 GMV', value: recentGmv, prefix: '¥', precision: 2 },
      { title: '近30天订单', value: recentOrders, suffix: '单', precision: 0 },
      { title: '近30天客单价', value: recentAov, prefix: '¥', precision: 2 },
    ];
  }, [summary]);

  const handleRefresh = async () => {
    await Promise.all([refreshPlatformTrend(), refreshSummary()]);
  };

  return (
    <MainLayout>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Space orientation="vertical" size={2} style={{ margin: '16px 0' }}>
          <Breadcrumb items={[{ title: '数据看板' }, { title: '平台总览' }]} />
          <Typography.Text type="secondary">多平台经营数据总览与趋势追踪</Typography.Text>
        </Space>
        <Space wrap size={[8, 8]} style={headerControlWrapStyle}>
          <Tag color="processing">维度：{dimension === 'day' ? '日' : dimension === 'week' ? '周' : '月'}</Tag>
          <Tag color="default">指标：{metric === 'gmv' ? '销售额' : '订单量'}</Tag>
          {lastUpdatedAt ? <Tag color="success">上次刷新：{lastUpdatedAt}</Tag> : null}
          <Button size="small" icon={<ReloadOutlined />} loading={isRefreshing} onClick={handleRefresh}>
            刷新
          </Button>
          <Radio.Group size="small" value={dimension} onChange={(e) => setDimension(e.target.value)} buttonStyle="solid">
            <Radio.Button value="day">日维度</Radio.Button>
            <Radio.Button value="week">周维度</Radio.Button>
            <Radio.Button value="month">月维度</Radio.Button>
          </Radio.Group>
          <Radio.Group size="small" value={metric} onChange={(e) => setMetric(e.target.value)} buttonStyle="solid">
            <Radio.Button value="order">订单量</Radio.Button>
            <Radio.Button value="gmv">销售额</Radio.Button>
          </Radio.Group>
        </Space>
      </div>

      <div style={{ padding: 24, minHeight: 360, background: colorBgContainer, borderRadius: borderRadiusLG }}>
        {summaryError || platformTrendError ? (
          <Alert
            type="error"
            showIcon
            message="看板数据加载失败"
            description="请稍后刷新重试，或检查接口服务状态。"
            style={pageAlertStyle}
          />
        ) : null}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          {summaryCards.map((card) => (
            <Col xs={24} md={12} lg={8} xl={4} key={card.title} style={{ display: 'flex' }}>
              <Card loading={isSummaryLoading} size="small" style={{ width: '100%' }} styles={{ body: statCardBodyStyle }}>
                <Statistic
                  title={card.title}
                  value={card.value}
                  precision={card.precision}
                  prefix={card.prefix}
                  suffix={card.suffix}
                />
              </Card>
            </Col>
          ))}
        </Row>

        <Card
          size="small"
          title={<Typography.Text style={sectionCardTitleStyle}>各平台趋势</Typography.Text>}
          extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>统一展示口径：{metric === 'gmv' ? '销售额（元）' : '订单量（单）'}</Typography.Text>}
          style={{ marginBottom: 24 }}
          styles={isPlatformTrendLoading ? trendCardLoadingStyles : sectionCardStyles}
        >
          <PlatformTrendChart data={chartData} loading={isPlatformTrendLoading} metric={metric} />
        </Card>

        <PlatformTrendGrid data={chartData} loading={isPlatformTrendLoading} metric={metric} />
      </div>
    </MainLayout>
  );
};

export default OverviewPage;

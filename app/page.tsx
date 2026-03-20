'use client';
import React, { useState } from 'react';
import { Card, Row, Col, Statistic, Radio, Space, theme, Breadcrumb, Tag, Empty, Alert, Tooltip, Button, message } from 'antd';
import useSWR from 'swr';
import PlatformTrendChart from './components/Charts/PlatformTrendChart';
import PlatformTrendGrid from './components/Charts/PlatformTrendGrid';
import { ArrowUpOutlined, ArrowDownOutlined, CopyOutlined } from '@ant-design/icons';
import MainLayout from './components/MainLayout';
import type { PlatformTrendPoint, PlatformTrendTotal, PlatformTrendViewData } from './components/Charts/types';
import ReactECharts from 'echarts-for-react';

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
  zulinSummary?: {
    date: string;
    exposure: number;
    visits: number;
    revenue: number;
    conversionRate: string;
    sourceFile: string;
  } | null;
}

interface ZulinPanelResponse {
  summary: {
    date: string;
    exposure: number;
    visits: number;
    revenue: number;
    conversionRate: string;
  } | null;
  trend: Array<{
    date: string;
    exposure: number;
    visits: number;
    revenue: number;
    conversionRate: number;
    conversionRateText: string;
  }>;
  sourceFile: string | null;
}

interface DailyOpsCard {
  id: string;
  title: string;
  level: 'high' | 'medium' | 'low';
  tag: '可执行' | '观察项';
  scope: 'controllable' | 'all';
  insight: string;
  action: string;
  linkName?: string;
  linkFullName?: string;
  linkId?: string;
  metric: {
    unit: '¥' | '单' | '%';
    current: number;
    previous: number;
    changeRate: number;
  };
}

interface DailyOpsResponse {
  summary?: {
    controllable?: {
      gmv: number;
      orders: number;
      aov: number;
      prevGmv: number;
      prevOrders: number;
      prevAov: number;
    };
    all?: {
      gmv: number;
      orders: number;
      aov: number;
      prevGmv: number;
      prevOrders: number;
      prevAov: number;
    };
    controllableShare?: number;
    prevControllableShare?: number;
  };
  cards?: DailyOpsCard[];
  controllablePlatforms?: string[];
}

const App: React.FC = () => {
  const [dimension, setDimension] = useState<'day' | 'week' | 'month'>('day');
  const [metric, setMetric] = useState<'gmv' | 'order'>('order'); // 'gmv' | 'order'

  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const { data: platformTrend, isLoading: isPlatformTrendLoading } = useSWR<PlatformTrendApiResponse>(`/api/dashboard/platform-trend?days=${dimension}`, fetcher);
  const { data: summary, isLoading: isSummaryLoading } = useSWR<DashboardSummaryData>('/api/dashboard/summary', fetcher);
  const { data: zulinPanel, isLoading: isZulinPanelLoading } = useSWR<ZulinPanelResponse>(
    dimension === 'day' ? '/api/dashboard/zulin' : null,
    fetcher,
  );
  const { data: dailyOps, isLoading: isDailyOpsLoading, error: dailyOpsError } = useSWR<DailyOpsResponse>(
    dimension === 'day' ? '/api/dashboard/daily-ops' : null,
    fetcher,
  );

  const dailyOpsData = React.useMemo(() => {
    const controllable = dailyOps?.summary?.controllable;
    const all = dailyOps?.summary?.all;
    const share = toNumber(dailyOps?.summary?.controllableShare);
    const prevShare = toNumber(dailyOps?.summary?.prevControllableShare);
    const cards = Array.isArray(dailyOps?.cards) ? dailyOps.cards : [];
    const calculateChangeRate = (current: number, previous: number) => {
      if (!previous) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    const controllableGmv = toNumber(controllable?.gmv);
    const controllableOrders = toNumber(controllable?.orders);
    const controllableAov = toNumber(controllable?.aov);
    const controllablePrevGmv = toNumber(controllable?.prevGmv);
    const controllablePrevOrders = toNumber(controllable?.prevOrders);
    const controllablePrevAov = toNumber(controllable?.prevAov);

    const allGmv = toNumber(all?.gmv);
    const allOrders = toNumber(all?.orders);
    const allAov = toNumber(all?.aov);
    const allPrevGmv = toNumber(all?.prevGmv);
    const allPrevOrders = toNumber(all?.prevOrders);
    const allPrevAov = toNumber(all?.prevAov);

    return {
      controllable: {
        gmv: controllableGmv,
        orders: controllableOrders,
        aov: controllableAov,
        gmvChange: calculateChangeRate(controllableGmv, controllablePrevGmv),
        orderChange: calculateChangeRate(controllableOrders, controllablePrevOrders),
        aovChange: calculateChangeRate(controllableAov, controllablePrevAov),
      },
      all: {
        gmv: allGmv,
        orders: allOrders,
        aov: allAov,
        gmvChange: calculateChangeRate(allGmv, allPrevGmv),
        orderChange: calculateChangeRate(allOrders, allPrevOrders),
        aovChange: calculateChangeRate(allAov, allPrevAov),
      },
      share,
      shareDiff: share - prevShare,
      cards,
      controllablePlatforms: Array.isArray(dailyOps?.controllablePlatforms) ? dailyOps.controllablePlatforms : [],
    };
  }, [dailyOps]);

  // Transform Data for Chart based on metric
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

  const renderMetricValue = (unit: '¥' | '单' | '%', value: number) => {
    if (unit === '¥') return `¥${value.toFixed(2)}`;
    if (unit === '%') return `${value.toFixed(1)}%`;
    return `${value.toFixed(0)}单`;
  };

  const renderChangeValue = (value: number, suffix: string = '%') => {
    if (value === 0) {
      return <span style={{ color: '#8c8c8c' }}>0.0{suffix}</span>;
    }
    const isPositive = value > 0;
    const color = isPositive ? '#3f8600' : '#cf1322';
    return (
      <span style={{ color }}>
        {isPositive ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
        {isPositive ? '+' : '-'}
        {Math.abs(value).toFixed(1)}
        {suffix}
      </span>
    );
  };

  const copyText = async (text: string, successText: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(successText);
    } catch {
      message.error('复制失败，请手动复制');
    }
  };

  const levelColor: Record<DailyOpsCard['level'], string> = {
    high: 'red',
    medium: 'orange',
    low: 'blue',
  };
  const levelLabel: Record<DailyOpsCard['level'], string> = {
    high: '高优先级',
    medium: '中优先级',
    low: '低优先级',
  };
  const zulinSummary = summary?.zulinSummary || null;
  const zulinTrend = React.useMemo(
    () => (Array.isArray(zulinPanel?.trend) ? zulinPanel.trend : []),
    [zulinPanel]
  );
  const zulinChartOption = React.useMemo(() => {
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['曝光次数', '商品访问次数', '交易金额'] },
      grid: { left: '3%', right: '4%', bottom: '18%', containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: zulinTrend.map((item) => item.date),
        axisLabel: {
          margin: 14,
          hideOverlap: true,
        },
      },
      yAxis: [
        { type: 'value', name: '曝光/访问' },
        { type: 'value', name: '金额', axisLabel: { formatter: (value: number) => `¥${value}` } },
      ],
      series: [
        {
          name: '曝光次数',
          type: 'line',
          smooth: true,
          data: zulinTrend.map((item) => toNumber(item.exposure)),
        },
        {
          name: '商品访问次数',
          type: 'line',
          smooth: true,
          data: zulinTrend.map((item) => toNumber(item.visits)),
        },
        {
          name: '交易金额',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: zulinTrend.map((item) => toNumber(item.revenue)),
        },
      ],
    };
  }, [zulinTrend]);

  return (
    <MainLayout>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Breadcrumb style={{ margin: '16px 0' }} items={[{ title: '数据看板' }, { title: '概览' }]} />
        <Radio.Group value={dimension} onChange={(e) => setDimension(e.target.value)} buttonStyle="solid">
          <Radio.Button value="day">日维度</Radio.Button>
          <Radio.Button value="week">周维度</Radio.Button>
          <Radio.Button value="month">月维度</Radio.Button>
        </Radio.Group>
      </div>
      
      <div style={{ padding: 24, minHeight: 360, background: colorBgContainer, borderRadius: borderRadiusLG }}>
        {dimension === 'day' && (
          <div>
          <Card
            title="支付宝小程序运营概览（芝麻租赁）"
            loading={isSummaryLoading || isZulinPanelLoading}
            extra={
              <Space size={8}>
                {zulinSummary?.date ? <Tag color="processing">最新日期：{zulinSummary.date}</Tag> : null}
                {zulinPanel?.sourceFile ? <Tag color="default">来源：{zulinPanel.sourceFile}</Tag> : null}
              </Space>
            }
          >
            {zulinSummary ? (
              <>
              <Row gutter={16}>
                <Col xs={24} md={6} style={{ marginBottom: 12 }}>
                  <Statistic title="曝光次数" value={toNumber(zulinSummary.exposure)} />
                </Col>
                <Col xs={24} md={6} style={{ marginBottom: 12 }}>
                  <Statistic title="商品访问次数" value={toNumber(zulinSummary.visits)} />
                </Col>
                <Col xs={24} md={6} style={{ marginBottom: 12 }}>
                  <Statistic title="交易金额（元）" value={toNumber(zulinSummary.revenue)} precision={2} prefix="¥" />
                </Col>
                <Col xs={24} md={6} style={{ marginBottom: 12 }}>
                  <Statistic title="访问转化率" value={toNumber(String(zulinSummary.conversionRate).replace('%', ''))} precision={2} suffix="%" />
                </Col>
              </Row>
              {zulinTrend.length > 0 ? (
                <ReactECharts option={zulinChartOption} style={{ height: 320, marginTop: 8, marginBottom: 8 }} />
              ) : (
                <Empty description="暂无芝麻租赁趋势数据" />
              )}
              </>
            ) : (
              <Empty description="暂无芝麻租赁分析结果，请先执行日分析脚本" />
            )}
          </Card>

          <Card
            title="每日运营卡片"
            loading={isDailyOpsLoading}
            extra={
              <Space size={8}>
                {dailyOpsData.controllablePlatforms.map((name) => (
                  <Tag key={name} color="processing">
                    {name}
                  </Tag>
                ))}
              </Space>
            }
          >
            {dailyOpsError ? (
              <Alert type="error" showIcon message="运营卡片加载失败" description="请稍后重试或检查数据同步状态" />
            ) : (
              <>
                <Row gutter={16}>
                  <Col xs={24} md={8}>
                    <Statistic
                      title="可控渠道 GMV（近7天）"
                      value={dailyOpsData.controllable.gmv}
                      precision={2}
                      prefix="¥"
                      suffix={<span style={{ marginLeft: 8, fontSize: 12 }}>{renderChangeValue(dailyOpsData.controllable.gmvChange)}</span>}
                    />
                  </Col>
                  <Col xs={24} md={8}>
                    <Statistic
                      title="可控渠道订单（近7天）"
                      value={dailyOpsData.controllable.orders}
                      suffix={<span style={{ marginLeft: 8, fontSize: 12 }}>{renderChangeValue(dailyOpsData.controllable.orderChange)}</span>}
                    />
                  </Col>
                  <Col xs={24} md={8}>
                    <Statistic
                      title="可控渠道占比（GMV）"
                      value={dailyOpsData.share}
                      precision={1}
                      suffix={
                        <span style={{ marginLeft: 8, fontSize: 12 }}>
                          {renderChangeValue(dailyOpsData.shareDiff, 'pct')}
                        </span>
                      }
                    />
                  </Col>
                </Row>
                <Row gutter={16} style={{ marginTop: 12 }}>
                  <Col xs={24} md={8}>
                    <Statistic
                      title="全渠道 GMV（近7天）"
                      value={dailyOpsData.all.gmv}
                      precision={2}
                      prefix="¥"
                      suffix={<span style={{ marginLeft: 8, fontSize: 12 }}>{renderChangeValue(dailyOpsData.all.gmvChange)}</span>}
                    />
                  </Col>
                  <Col xs={24} md={8}>
                    <Statistic
                      title="全渠道订单（近7天）"
                      value={dailyOpsData.all.orders}
                      suffix={<span style={{ marginLeft: 8, fontSize: 12 }}>{renderChangeValue(dailyOpsData.all.orderChange)}</span>}
                    />
                  </Col>
                  <Col xs={24} md={8}>
                    <Statistic
                      title="可控渠道客单价"
                      value={dailyOpsData.controllable.aov}
                      precision={2}
                      prefix="¥"
                      suffix={<span style={{ marginLeft: 8, fontSize: 12 }}>{renderChangeValue(dailyOpsData.controllable.aovChange)}</span>}
                    />
                  </Col>
                </Row>

                <div style={{ marginTop: 16 }}>
                  {dailyOpsData.cards.length === 0 ? (
                    <Empty description="暂无运营建议" />
                  ) : (
                    <Row gutter={[16, 16]}>
                      {dailyOpsData.cards.map((card) => (
                        <Col xs={24} md={12} lg={8} key={card.id} style={{ display: 'flex' }}>
                          <Card size="small" title={card.title} style={{ width: '100%' }} bodyStyle={{ minHeight: 190, display: 'flex', flexDirection: 'column' }}>
                            <Space size={8} style={{ marginBottom: 10 }}>
                              <Tag color={card.tag === '可执行' ? 'success' : 'default'}>{card.tag}</Tag>
                              <Tag color={levelColor[card.level]}>{levelLabel[card.level]}</Tag>
                              <Tag color={card.scope === 'controllable' ? 'processing' : 'purple'}>
                                {card.scope === 'controllable' ? '可控渠道' : '全渠道'}
                              </Tag>
                            </Space>
                            {card.linkFullName ? (
                              <Tooltip title={card.linkFullName}>
                                <div style={{ marginBottom: 8, cursor: 'help' }}>{card.insight}</div>
                              </Tooltip>
                            ) : (
                              <div style={{ marginBottom: 8 }}>{card.insight}</div>
                            )}
                            <div style={{ color: '#595959', marginBottom: 10 }}>{card.action}</div>
                            {card.linkName && card.linkId ? (
                              <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 10 }}>
                                链接：
                                {card.linkFullName ? (
                                  <Tooltip title={card.linkFullName}>
                                    <span style={{ cursor: 'help' }}>{card.linkName}</span>
                                  </Tooltip>
                                ) : (
                                  card.linkName
                                )}
                                <Tooltip title="复制名称">
                                  <Button
                                    type="text"
                                    size="small"
                                    style={{ color: '#1677ff' }}
                                    icon={<CopyOutlined />}
                                    onClick={() => copyText(card.linkFullName || card.linkName || '', '名称已复制')}
                                  />
                                </Tooltip>
                                <br />
                                链接ID：{card.linkId}
                                <Tooltip title="复制ID">
                                  <Button
                                    type="text"
                                    size="small"
                                    style={{ color: '#1677ff' }}
                                    icon={<CopyOutlined />}
                                    onClick={() => copyText(card.linkId || '', 'ID已复制')}
                                  />
                                </Tooltip>
                              </div>
                            ) : null}
                            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 'auto' }}>
                              当前: {renderMetricValue(card.metric.unit, toNumber(card.metric.current))} ｜ 上期: {renderMetricValue(card.metric.unit, toNumber(card.metric.previous))}
                              {' ｜ 变化: '}
                              {renderChangeValue(toNumber(card.metric.changeRate))}
                            </div>
                          </Card>
                        </Col>
                      ))}
                    </Row>
                  )}
                </div>
              </>
            )}
          </Card>
          </div>
        )}

        <div style={{ marginTop: 24 }}>
           <Card 
             title="各平台趋势" 
             extra={
               <Radio.Group value={metric} onChange={(e) => setMetric(e.target.value)} size="small">
                 <Radio.Button value="order">订单量</Radio.Button>
                 <Radio.Button value="gmv">销售额</Radio.Button>
               </Radio.Group>
             }
           >
              <PlatformTrendChart data={chartData} loading={isPlatformTrendLoading} />
           </Card>
        </div>
        
        <div style={{ marginTop: 24 }}>
          <PlatformTrendGrid data={chartData} loading={isPlatformTrendLoading} />
        </div>
      </div>
    </MainLayout>
  );
};

export default App;

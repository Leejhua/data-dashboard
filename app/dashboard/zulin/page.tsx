'use client';
import React from 'react';
import { Card, Row, Col, Statistic, Space, theme, Breadcrumb, Tag, Empty, Alert, Tooltip, Button, message, Table, Typography } from 'antd';
import useSWR from 'swr';
import { ArrowUpOutlined, ArrowDownOutlined, CopyOutlined, ReloadOutlined } from '@ant-design/icons';
import MainLayout from '../../components/MainLayout';
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

const formatInteger = (value: number) => toNumber(value).toLocaleString('zh-CN');
const formatCurrency = (value: number) =>
  `¥${toNumber(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const swrStableOptions = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  dedupingInterval: 60000,
};

const statCardBodyStyle: React.CSSProperties = { minHeight: 116, padding: '16px 18px' };
const adviceCardBodyStyle: React.CSSProperties = { minHeight: 214, display: 'flex', flexDirection: 'column', padding: 16 };
const sectionCardTitleStyle: React.CSSProperties = { fontWeight: 600, fontSize: 14 };
const sectionCardStyles: { header: React.CSSProperties; body: React.CSSProperties } = {
  header: { padding: '12px 16px' },
  body: { padding: 16 },
};
const productTableBodyHeight = 390;
const productListCardStyles: { header: React.CSSProperties; body: React.CSSProperties } = {
  header: sectionCardStyles.header,
  body: { ...sectionCardStyles.body, minHeight: productTableBodyHeight + 48 },
};
const pageAlertStyle: React.CSSProperties = { marginBottom: 16 };
const pageEmptyStyle: React.CSSProperties = { margin: '8px 0' };
const overviewCardLoadingStyles: { header: React.CSSProperties; body: React.CSSProperties } = {
  header: sectionCardStyles.header,
  body: { ...sectionCardStyles.body, minHeight: 420 },
};
const dailyOpsCardLoadingStyles: { header: React.CSSProperties; body: React.CSSProperties } = {
  header: sectionCardStyles.header,
  body: { ...sectionCardStyles.body, minHeight: 360 },
};
const headerControlWrapStyle: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end', rowGap: 8 };

interface ZulinProductRow {
  productId: string;
  title: string;
  exposure: number;
  visits: number;
  revenue: number;
  managedDays: number;
  conversionRate: number;
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
  topExposureProducts: ZulinProductRow[];
  lowExposureProducts: ZulinProductRow[];
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

const ZulinPage: React.FC = () => {
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const { data: zulinPanel, isLoading: isZulinPanelLoading, isValidating: isZulinPanelValidating, mutate: refreshZulinPanel, error: zulinPanelError } = useSWR<ZulinPanelResponse>(
    '/api/dashboard/zulin',
    fetcher,
    swrStableOptions
  );
  const { data: dailyOps, isLoading: isDailyOpsLoading, isValidating: isDailyOpsValidating, mutate: refreshDailyOps, error: dailyOpsError } = useSWR<DailyOpsResponse>(
    '/api/dashboard/daily-ops',
    fetcher,
    swrStableOptions
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

  const renderMetricValue = (unit: '¥' | '单' | '%', value: number) => {
    if (unit === '¥') return formatCurrency(value);
    if (unit === '%') return `${value.toFixed(1)}%`;
    return `${formatInteger(value)}单`;
  };

  const renderChangeValue = (value: number, suffix: string = '%') => {
    if (value === 0) {
      return <span style={{ color: '#8c8c8c' }}>0.0{suffix}</span>;
    }
    const isPositive = value > 0;
    const color = isPositive ? '#cf1322' : '#3f8600';
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
  const zulinSummary = zulinPanel?.summary || null;
  const zulinTrend = React.useMemo(() => (Array.isArray(zulinPanel?.trend) ? zulinPanel.trend : []), [zulinPanel]);
  const lastUpdatedAt = React.useMemo(() => {
    if (!zulinPanel && !dailyOps) {
      return '';
    }
    return new Date().toLocaleString('zh-CN', { hour12: false });
  }, [zulinPanel, dailyOps]);
  const isRefreshing = isZulinPanelValidating || isDailyOpsValidating;
  const topExposureProducts = Array.isArray(zulinPanel?.topExposureProducts) ? zulinPanel.topExposureProducts : [];
  const lowExposureProducts = Array.isArray(zulinPanel?.lowExposureProducts) ? zulinPanel.lowExposureProducts : [];
  const handleRefresh = async () => {
    await Promise.all([refreshZulinPanel(), refreshDailyOps()]);
  };
  const zulinChartOption = React.useMemo(() => {
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: Array<{ marker: string; seriesName: string; value: number | string; axisValueLabel?: string }>) => {
          const date = params[0]?.axisValueLabel || '';
          const lines = params.map((item) => {
            const numeric = toNumber(item.value);
            const renderedValue = item.seriesName === '交易金额'
              ? formatCurrency(numeric)
              : formatInteger(numeric);
            return `${item.marker}${item.seriesName}：${renderedValue}`;
          });
          return [date, ...lines].join('<br/>');
        },
      },
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
        { type: 'value', name: '曝光/访问', axisLabel: { formatter: (value: number) => formatInteger(value) } },
        { type: 'value', name: '金额', axisLabel: { formatter: (value: number) => `¥${value.toLocaleString('zh-CN')}` } },
      ],
      series: [
        {
          name: '曝光次数',
          type: 'line',
          smooth: true,
          color: '#1677ff',
          data: zulinTrend.map((item) => toNumber(item.exposure)),
        },
        {
          name: '商品访问次数',
          type: 'line',
          smooth: true,
          color: '#722ed1',
          data: zulinTrend.map((item) => toNumber(item.visits)),
        },
        {
          name: '交易金额',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          color: '#fa8c16',
          data: zulinTrend.map((item) => toNumber(item.revenue)),
        },
      ],
    };
  }, [zulinTrend]);

  const productColumns = [
    {
      title: '排名',
      key: 'rank',
      width: 68,
      render: (_: unknown, __: ZulinProductRow, index: number) => {
        if (index < 3) {
          return <Tag color="gold">{index + 1}</Tag>;
        }
        return index + 1;
      },
    },
    {
      title: '商品',
      dataIndex: 'title',
      key: 'title',
      ellipsis: { showTitle: false },
      render: (value: string) => (
        <Tooltip title={value}>
          <span>{value}</span>
        </Tooltip>
      ),
    },
    {
      title: '曝光',
      dataIndex: 'exposure',
      key: 'exposure',
      width: 90,
      align: 'right' as const,
      render: (val: number) => formatInteger(val),
    },
    {
      title: '访问',
      dataIndex: 'visits',
      key: 'visits',
      width: 90,
      align: 'right' as const,
      render: (val: number) => formatInteger(val),
    },
    {
      title: '转化率',
      dataIndex: 'conversionRate',
      key: 'conversionRate',
      width: 100,
      align: 'right' as const,
      render: (val: number) => `${toNumber(val).toFixed(2)}%`,
    },
    {
      title: '金额',
      dataIndex: 'revenue',
      key: 'revenue',
      width: 120,
      align: 'right' as const,
      render: (val: number) => formatCurrency(val),
    },
  ];

  return (
    <MainLayout>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Space orientation="vertical" size={2} style={{ margin: '16px 0' }}>
          <Breadcrumb items={[{ title: '数据看板' }, { title: '芝麻租赁' }]} />
          <Typography.Text type="secondary">支付宝小程序经营数据与运营建议追踪（默认按昨日统计口径）</Typography.Text>
        </Space>
        <Space wrap size={[8, 8]} style={headerControlWrapStyle}>
          {lastUpdatedAt ? <Tag color="success">上次刷新：{lastUpdatedAt}</Tag> : null}
          <Button size="small" icon={<ReloadOutlined />} loading={isRefreshing} onClick={handleRefresh}>
            刷新
          </Button>
        </Space>
      </div>

      <div style={{ padding: 24, minHeight: 360, background: colorBgContainer, borderRadius: borderRadiusLG }}>
        {zulinPanelError ? (
          <Alert style={pageAlertStyle} type="error" showIcon message="芝麻租赁看板加载失败" description="请稍后重试或检查数据同步状态" />
        ) : null}
        <Card
          size="small"
          title={<Typography.Text style={sectionCardTitleStyle}>支付宝小程序运营概览（芝麻租赁）</Typography.Text>}
          loading={isZulinPanelLoading}
          extra={
            <Space size={[8, 8]} wrap>
              {zulinSummary?.date ? <Tag color="processing">最新统计日：{zulinSummary.date}</Tag> : null}
              {zulinPanel?.sourceFile ? <Tag color="default">来源：{zulinPanel.sourceFile}</Tag> : null}
            </Space>
          }
          style={{ marginBottom: 24 }}
          styles={isZulinPanelLoading ? overviewCardLoadingStyles : sectionCardStyles}
        >
          {zulinSummary ? (
            <>
              <Row gutter={16}>
                <Col xs={24} md={6} style={{ marginBottom: 12 }}>
                  <Statistic title="曝光次数" value={toNumber(zulinSummary.exposure)} formatter={(value) => formatInteger(Number(value))} />
                </Col>
                <Col xs={24} md={6} style={{ marginBottom: 12 }}>
                  <Statistic title="商品访问次数" value={toNumber(zulinSummary.visits)} formatter={(value) => formatInteger(Number(value))} />
                </Col>
                <Col xs={24} md={6} style={{ marginBottom: 12 }}>
                  <Statistic title="交易金额（元）" value={toNumber(zulinSummary.revenue)} formatter={(value) => formatCurrency(Number(value))} />
                </Col>
                <Col xs={24} md={6} style={{ marginBottom: 12 }}>
                  <Statistic title="访问转化率" value={toNumber(String(zulinSummary.conversionRate).replace('%', ''))} precision={2} suffix="%" />
                </Col>
              </Row>
              {zulinTrend.length > 0 ? (
                <ReactECharts option={zulinChartOption} style={{ height: 320, marginTop: 8, marginBottom: 8 }} />
              ) : (
                <Empty description="暂无芝麻租赁趋势数据" style={pageEmptyStyle} />
              )}
            </>
          ) : (
            <Empty description="暂无芝麻租赁分析结果，请先上传昨日数据" style={pageEmptyStyle} />
          )}
        </Card>

        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col xs={24} lg={12}>
            <Card size="small" title={<Typography.Text style={sectionCardTitleStyle}>最新统计日曝光 Top10 商品</Typography.Text>} styles={productListCardStyles}>
              <Table
                columns={productColumns}
                dataSource={topExposureProducts}
                rowKey="productId"
                pagination={false}
                size="small"
                locale={{ emptyText: '暂无 Top10 曝光数据' }}
                scroll={{ x: 560, y: productTableBodyHeight }}
              />
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card
              size="small"
              title={<Typography.Text style={sectionCardTitleStyle}>预警商品</Typography.Text>}
              extra={<Tag color="warning">命中 {lowExposureProducts.length} 条</Tag>}
              styles={productListCardStyles}
            >
              <Table
                columns={productColumns}
                dataSource={lowExposureProducts}
                rowKey="productId"
                pagination={false}
                size="small"
                locale={{ emptyText: '暂无符合条件商品' }}
                scroll={{ x: 560, y: productTableBodyHeight }}
              />
            </Card>
          </Col>
        </Row>

        <Card
          size="small"
          title={<Typography.Text style={sectionCardTitleStyle}>每日运营卡片</Typography.Text>}
          loading={isDailyOpsLoading}
          extra={
            <Space size={[8, 8]} wrap>
              {dailyOpsData.controllablePlatforms.map((name) => (
                <Tag key={name} color="processing">
                  {name}
                </Tag>
              ))}
            </Space>
          }
          styles={isDailyOpsLoading ? dailyOpsCardLoadingStyles : sectionCardStyles}
        >
          {dailyOpsError ? (
            <Alert type="error" showIcon message="运营卡片加载失败" description="请稍后重试或检查数据同步状态" style={pageAlertStyle} />
          ) : (
            <>
              <Row gutter={[16, 16]}>
                <Col xs={24} md={8} style={{ display: 'flex' }}>
                  <Card size="small" style={{ width: '100%' }} styles={{ body: statCardBodyStyle }}>
                    <Statistic
                      title="可控渠道 GMV（近7天）"
                      value={dailyOpsData.controllable.gmv}
                      formatter={(value) => formatCurrency(Number(value))}
                      suffix={<span style={{ marginLeft: 8, fontSize: 12 }}>{renderChangeValue(dailyOpsData.controllable.gmvChange)}</span>}
                    />
                  </Card>
                </Col>
                <Col xs={24} md={8} style={{ display: 'flex' }}>
                  <Card size="small" style={{ width: '100%' }} styles={{ body: statCardBodyStyle }}>
                    <Statistic
                      title="可控渠道订单（近7天）"
                      value={dailyOpsData.controllable.orders}
                      formatter={(value) => formatInteger(Number(value))}
                      suffix={<span style={{ marginLeft: 8, fontSize: 12 }}>{renderChangeValue(dailyOpsData.controllable.orderChange)}</span>}
                    />
                  </Card>
                </Col>
                <Col xs={24} md={8} style={{ display: 'flex' }}>
                  <Card size="small" style={{ width: '100%' }} styles={{ body: statCardBodyStyle }}>
                    <Statistic
                      title="可控渠道占比（GMV）"
                      value={dailyOpsData.share}
                      precision={1}
                      suffix={
                        <span style={{ marginLeft: 8, fontSize: 12 }}>
                          {renderChangeValue(dailyOpsData.shareDiff, 'pp')}
                        </span>
                      }
                    />
                  </Card>
                </Col>
              </Row>
              <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
                <Col xs={24} md={8} style={{ display: 'flex' }}>
                  <Card size="small" style={{ width: '100%' }} styles={{ body: statCardBodyStyle }}>
                    <Statistic
                      title="全渠道 GMV（近7天）"
                      value={dailyOpsData.all.gmv}
                      formatter={(value) => formatCurrency(Number(value))}
                      suffix={<span style={{ marginLeft: 8, fontSize: 12 }}>{renderChangeValue(dailyOpsData.all.gmvChange)}</span>}
                    />
                  </Card>
                </Col>
                <Col xs={24} md={8} style={{ display: 'flex' }}>
                  <Card size="small" style={{ width: '100%' }} styles={{ body: statCardBodyStyle }}>
                    <Statistic
                      title="全渠道订单（近7天）"
                      value={dailyOpsData.all.orders}
                      formatter={(value) => formatInteger(Number(value))}
                      suffix={<span style={{ marginLeft: 8, fontSize: 12 }}>{renderChangeValue(dailyOpsData.all.orderChange)}</span>}
                    />
                  </Card>
                </Col>
                <Col xs={24} md={8} style={{ display: 'flex' }}>
                  <Card size="small" style={{ width: '100%' }} styles={{ body: statCardBodyStyle }}>
                    <Statistic
                      title="可控渠道客单价"
                      value={dailyOpsData.controllable.aov}
                      formatter={(value) => formatCurrency(Number(value))}
                      suffix={<span style={{ marginLeft: 8, fontSize: 12 }}>{renderChangeValue(dailyOpsData.controllable.aovChange)}</span>}
                    />
                  </Card>
                </Col>
              </Row>

              <div style={{ marginTop: 16 }}>
                {dailyOpsData.cards.length === 0 ? (
                  <Empty description="暂无运营建议" style={pageEmptyStyle} />
                ) : (
                  <Row gutter={[16, 16]}>
                    {dailyOpsData.cards.map((card) => (
                      <Col xs={24} md={12} lg={8} key={card.id} style={{ display: 'flex' }}>
                        <Card size="small" title={<Typography.Text style={sectionCardTitleStyle}>{card.title}</Typography.Text>} style={{ width: '100%' }} styles={{ body: adviceCardBodyStyle }}>
                          <Space size={8} wrap style={{ marginBottom: 10 }}>
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
                            <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 10, lineHeight: 1.8 }}>
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
                          <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 'auto', borderTop: '1px solid #f0f0f0', paddingTop: 10 }}>
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
    </MainLayout>
  );
};

export default ZulinPage;


'use client';
import React, { useState } from 'react';
import { Breadcrumb, theme, Card, Row, Col, Statistic, Radio, Table, Space, Tooltip, Empty, Alert, DatePicker } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, InfoCircleOutlined } from '@ant-design/icons';
import useSWR from 'swr';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import MainLayout from '../components/MainLayout';
import ReactECharts from 'echarts-for-react';

const fetcher = async (url: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error || `请求失败: ${response.status}`);
    }
    return body;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('报表请求超时，请稍后重试');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const toNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

interface TrendTooltipParam {
  dataIndex: number;
  seriesName: string;
  marker: string;
  value: number | string;
}

interface PlatformRow {
  platform: string;
  orderCount: number;
  gmv: number;
  percentage: number;
}

interface DeviceRow {
  deviceName: string;
  count: number;
  gmv: number;
}

interface ReportData {
  summary?: {
    gmv: number;
    orderCount: number;
    aov: number;
    refundRate: number;
    prevGmv: number;
    prevOrderCount: number;
    prevAov: number;
    prevRefundRate: number;
    gmvGrowth: number;
    orderGrowth: number;
    aovGrowth: number;
  };
  trend?: {
    dates: string[];
    current: number[];
    previous: number[];
    currentSelf?: number[];
    previousSelf?: number[];
    currentDates?: string[];
    prevDates?: string[];
  };
  channelAnalysis?: {
    summary?: {
      self?: { gmv: number };
      third?: { gmv: number };
    };
    trend?: {
      dates: string[];
      self: number[];
      third: number[];
    };
  };
  platforms?: PlatformRow[];
  devices?: DeviceRow[];
  products?: DeviceRow[];
  zulin?: {
    summary?: {
      exposure: number;
      visits: number;
      revenue: number;
      conversionRate: number;
      prevExposure: number;
      prevVisits: number;
      prevRevenue: number;
      prevConversionRate: number;
      exposureGrowth: number;
      visitsGrowth: number;
      revenueGrowth: number;
      conversionDiff: number;
    };
    trend?: Array<{
      date: string;
      exposure: number;
      visits: number;
      revenue: number;
    }>;
    products?: Array<{
      productId: string;
      title: string;
      exposure: number;
      visits: number;
      revenue: number;
      conversionRate: number;
      revenueGrowth: number;
    }>;
  } | null;
}

type ReportPeriod = 'week' | 'biweek' | 'month' | 'current_week' | 'current_month';
const { RangePicker } = DatePicker;

const ReportsPage: React.FC = () => {
  const [period] = useState<ReportPeriod>('week');
  const mondayStart = React.useMemo(() => {
    const today = dayjs().startOf('day');
    const day = today.day();
    const offset = day === 0 ? 6 : day - 1;
    return today.subtract(offset, 'day');
  }, []);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>([
    dayjs().subtract(7, 'day').startOf('day'),
    dayjs().endOf('day'),
  ]);
  const [scope, setScope] = useState<'all' | 'self'>('all');
  
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const reportApi = React.useMemo(() => {
    if (dateRange) {
      const startDate = dateRange[0].format('YYYY-MM-DD');
      const endDate = dateRange[1].format('YYYY-MM-DD');
      return `/api/reports?scope=${scope}&startDate=${startDate}&endDate=${endDate}`;
    }
    return `/api/reports?period=${period}&scope=${scope}`;
  }, [dateRange, period, scope]);

  const { data, isLoading, error } = useSWR<ReportData>(reportApi, fetcher, {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
  });
  const loading = isLoading && !data && !error;

  const quickDatePresets = [
    {
      label: '本周',
      value: [mondayStart, dayjs().endOf('day')] as [Dayjs, Dayjs],
    },
    {
      label: '本月',
      value: [dayjs().startOf('month'), dayjs().endOf('day')] as [Dayjs, Dayjs],
    },
    {
      label: '近7天',
      value: [dayjs().subtract(7, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs],
    },
    {
      label: '近14天',
      value: [dayjs().subtract(14, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs],
    },
    {
      label: '近30天',
      value: [dayjs().subtract(30, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs],
    },
  ];

  const renderGrowth = (value: number) => {
    const numericValue = toNumber(value);
    const isPositive = numericValue >= 0;
    return (
      <span style={{ color: isPositive ? '#cf1322' : '#3f8600', fontSize: 14 }}>
        {isPositive ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
        {Math.abs(numericValue).toFixed(2)}%
      </span>
    );
  };

  // Chart Configuration
  const getTrendOption = () => {
    const trend = data?.trend;
    if (!trend) return {};
    
    const labels = trend.dates;
    const currentSeries = trend.current || [];
    const previousSeries = trend.previous || [];
    
    return {
      title: {
        text: scope === 'self' ? '趋势对比 (自有渠道)' : '趋势对比 (全渠道)',
        left: 'center'
      },
      tooltip: {
        trigger: 'axis',
        formatter: (params: TrendTooltipParam[]) => {
            let tooltip = '';
            
            if (params.length > 0) {
                const index = params[0].dataIndex;
                
                // Get dates safely
                const currentDate = trend.currentDates?.[index] || trend.dates[index] || '';
                const prevDate = trend.prevDates?.[index] || '';
                
                // Header: Current Date
                tooltip += `<b>${currentDate}</b><br/>`;
                
                params.forEach((item) => {
                    const isCurrent = item.seriesName === '本期';
                    const dateLabel = isCurrent ? currentDate : prevDate;
                    const displayDate = isCurrent ? '' : ` (${dateLabel})`; // Only show date for previous period
                    
                    // Format value
                    const value = typeof item.value === 'number' ? `¥${item.value.toFixed(2)}` : item.value;
                    
                    tooltip += `${item.marker} ${item.seriesName}${displayDate}: <b>${value}</b><br/>`;
                });
            }
            
            return tooltip;
        }
      },
      legend: {
        data: ['本期', '上期'],
        bottom: 0
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '10%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels // Use relative labels
      },
      yAxis: {
        type: 'value',
        min: 0, // Ensure axis starts at 0
        scale: true, // Allow scaling if values are close
        axisLabel: {
            formatter: (value: number) => `¥${value}`
        }
      },
      series: [
        {
          name: '本期',
          type: 'line',
          data: currentSeries,
          connectNulls: true, // Connect lines if data is null/undefined
          smooth: true,
          symbol: 'circle', // Show points explicitly
          symbolSize: 6,
          areaStyle: { opacity: 0.1 },
          itemStyle: { color: '#1890ff' }
        },
        {
          name: '上期',
          type: 'line',
          data: previousSeries,
          smooth: true,
          itemStyle: { color: '#faad14' },
          lineStyle: { type: 'dashed' }
        }
      ]
    };
  };

  // Platform Table Columns
  const platformColumns = [
    {
      title: '平台',
      dataIndex: 'platform',
      key: 'platform',
    },
    {
      title: '订单量',
      dataIndex: 'orderCount',
      key: 'orderCount',
      sorter: (a: PlatformRow, b: PlatformRow) => a.orderCount - b.orderCount,
    },
    {
      title: '销售额 (GMV)',
      dataIndex: 'gmv',
      key: 'gmv',
      render: (val: number) => `¥${toNumber(val).toFixed(2)}`,
      sorter: (a: PlatformRow, b: PlatformRow) => a.gmv - b.gmv,
    },
    {
      title: '客单价 (AOV)',
      key: 'aov',
      render: (_: unknown, record: PlatformRow) => `¥${(record.gmv / (record.orderCount || 1)).toFixed(2)}`,
    },
    {
      title: '占比',
      dataIndex: 'percentage',
      key: 'percentage',
      render: (val: number) => `${toNumber(val).toFixed(1)}%`,
    }
  ];

  const deviceColumns = [
    {
      title: '排名',
      key: 'rank',
      width: 60,
      render: (_: unknown, __: DeviceRow, index: number) => index + 1,
    },
    {
      title: '设备名称',
      dataIndex: 'deviceName',
      key: 'deviceName',
      ellipsis: true,
    },
    {
      title: '销量',
      dataIndex: 'count',
      key: 'count',
      width: 100,
    },
    {
      title: '销售额',
      dataIndex: 'gmv',
      key: 'gmv',
      width: 150,
      render: (val: number) => `¥${toNumber(val).toFixed(2)}`,
    }
  ];

  const zulinProductColumns = [
    {
      title: '商品',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
    },
    {
      title: '交易金额',
      dataIndex: 'revenue',
      key: 'revenue',
      render: (val: number) => `¥${toNumber(val).toFixed(2)}`,
      sorter: (a: { revenue: number }, b: { revenue: number }) => a.revenue - b.revenue,
    },
    {
      title: '访问转化率',
      dataIndex: 'conversionRate',
      key: 'conversionRate',
      render: (val: number) => `${toNumber(val).toFixed(2)}%`,
    },
    {
      title: 'GMV环比',
      dataIndex: 'revenueGrowth',
      key: 'revenueGrowth',
      render: (val: number) => renderGrowth(toNumber(val)),
    },
  ];

  const zulinTrendOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['曝光', '访问', '交易金额'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '12%', containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: data?.zulin?.trend?.map((item) => item.date) || [],
    },
    yAxis: [
      { type: 'value', name: '曝光/访问' },
      { type: 'value', name: '金额', axisLabel: { formatter: (value: number) => `¥${value}` } },
    ],
    series: [
      {
        name: '曝光',
        type: 'line',
        smooth: true,
        data: data?.zulin?.trend?.map((item) => toNumber(item.exposure)) || [],
      },
      {
        name: '访问',
        type: 'line',
        smooth: true,
        data: data?.zulin?.trend?.map((item) => toNumber(item.visits)) || [],
      },
      {
        name: '交易金额',
        type: 'line',
        smooth: true,
        yAxisIndex: 1,
        data: data?.zulin?.trend?.map((item) => toNumber(item.revenue)) || [],
      },
    ],
  };

  return (
    <MainLayout>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Breadcrumb style={{ margin: '16px 0' }} items={[{ title: '数据报表' }, { title: '报表概览' }]} />
        <Space>
          <Radio.Group value={scope} onChange={(e) => setScope(e.target.value)} buttonStyle="solid">
            <Radio.Button value="all">全渠道</Radio.Button>
            <Radio.Button value="self">自有渠道</Radio.Button>
          </Radio.Group>
          <RangePicker
            value={dateRange}
            onChange={(dates) => setDateRange(dates && dates[0] && dates[1] ? [dates[0], dates[1]] : null)}
            presets={quickDatePresets}
            allowClear={false}
          />
        </Space>
      </div>
      
      <div style={{ padding: 24, minHeight: 360, background: colorBgContainer, borderRadius: borderRadiusLG }}>
        {error && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="报表加载失败"
            description={error instanceof Error ? error.message : '请稍后重试'}
          />
        )}
        {/* Scorecard */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6} style={{ display: 'flex' }}>
            <Card loading={loading} style={{ width: '100%' }} styles={{ body: { minHeight: 132 } }}>
              <Statistic 
                title="总销售额 (GMV)" 
                value={data?.summary?.gmv} 
                precision={2} 
                prefix="¥"
                suffix={renderGrowth(data?.summary?.gmvGrowth || 0)}
              />
              <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                上期: ¥{toNumber(data?.summary?.prevGmv).toFixed(2)}
              </div>
            </Card>
          </Col>
          <Col span={6} style={{ display: 'flex' }}>
            <Card loading={loading} style={{ width: '100%' }} styles={{ body: { minHeight: 132 } }}>
              <Statistic 
                title="总订单数" 
                value={data?.summary?.orderCount} 
                suffix={renderGrowth(data?.summary?.orderGrowth || 0)}
              />
              <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                上期: {data?.summary?.prevOrderCount || 0}
              </div>
            </Card>
          </Col>
          <Col span={6} style={{ display: 'flex' }}>
            <Card loading={loading} style={{ width: '100%' }} styles={{ body: { minHeight: 132 } }}>
              <Statistic 
                title="客单价 (AOV)" 
                value={data?.summary?.aov} 
                precision={2} 
                prefix="¥"
                suffix={renderGrowth(data?.summary?.aovGrowth || 0)}
              />
               <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                上期: ¥{toNumber(data?.summary?.prevAov).toFixed(2)}
              </div>
            </Card>
          </Col>
          <Col span={6} style={{ display: 'flex' }}>
            <Card loading={loading} style={{ width: '100%' }} styles={{ body: { minHeight: 132 } }}>
              <Statistic
                title={
                    <Space>
                        成交率
                        <Tooltip title="有效订单数 / 总订单数（排除已关闭和归还中）">
                            <InfoCircleOutlined style={{ fontSize: 14, color: '#999' }} />
                        </Tooltip>
                    </Space>
                }
                value={data?.summary?.refundRate}
                precision={2}
                suffix="%"
                style={{ color: toNumber(data?.summary?.refundRate) >= 50 ? '#cf1322' : '#3f8600' }}
              />
              <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                上期: {toNumber(data?.summary?.prevRefundRate).toFixed(2)}%
              </div>
            </Card>
          </Col>
        </Row>

        {/* Trend Chart */}
        <Card
          title="趋势对比"
          style={{ marginBottom: 24 }}
          loading={loading}
        >
          {data?.trend ? (
             <ReactECharts option={getTrendOption()} style={{ height: 350 }} />
          ) : <Empty />}
        </Card>

        {scope === 'self' && (
        <Card title="芝麻租赁表现（支付宝小程序）" style={{ marginBottom: 24 }} loading={loading}>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={6}>
              <Statistic
                title="曝光"
                value={data?.zulin?.summary?.exposure}
                suffix={renderGrowth(data?.zulin?.summary?.exposureGrowth || 0)}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="访问"
                value={data?.zulin?.summary?.visits}
                suffix={renderGrowth(data?.zulin?.summary?.visitsGrowth || 0)}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="交易金额"
                value={data?.zulin?.summary?.revenue}
                precision={2}
                prefix="¥"
                suffix={renderGrowth(data?.zulin?.summary?.revenueGrowth || 0)}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="访问转化率"
                value={data?.zulin?.summary?.conversionRate}
                precision={2}
                suffix={
                  <span>
                    %{' '}
                    <span style={{ fontSize: 12, color: toNumber(data?.zulin?.summary?.conversionDiff) >= 0 ? '#cf1322' : '#3f8600' }}>
                      {toNumber(data?.zulin?.summary?.conversionDiff) >= 0 ? '+' : ''}
                      {toNumber(data?.zulin?.summary?.conversionDiff).toFixed(2)}pct
                    </span>
                  </span>
                }
              />
            </Col>
          </Row>
          <Row gutter={24}>
            <Col span={14}>
              {data?.zulin?.trend && data.zulin.trend.length > 0 ? (
                <ReactECharts option={zulinTrendOption} style={{ height: 300 }} />
              ) : (
                <Empty description="暂无芝麻租赁趋势数据" />
              )}
            </Col>
            <Col span={10}>
              <Table
                columns={zulinProductColumns}
                dataSource={data?.zulin?.products || []}
                rowKey="productId"
                pagination={false}
                size="small"
              />
            </Col>
          </Row>
        </Card>
        )}

        {/* Channel Analysis */}
        {scope === 'all' && (
          <Card title="渠道构成分析 (自有 vs 三方)" style={{ marginBottom: 24 }} loading={loading}>
             <Row gutter={24}>
               <Col span={8}>
                  <ReactECharts 
                    option={{
                      tooltip: { trigger: 'item' },
                      legend: { bottom: 0 },
                      series: [
                        {
                          type: 'pie',
                          radius: ['40%', '70%'],
                          avoidLabelOverlap: false,
                          itemStyle: { borderRadius: 10, borderColor: '#fff', borderWidth: 2 },
                          label: {
                            show: true,
                            position: 'center',
                            formatter: 'GMV 占比',
                            fontSize: 16,
                            color: '#999'
                          },
                          labelLine: { show: false },
                          emphasis: {
                            label: {
                              show: true,
                              formatter: '{b}\n{d}%',
                              fontSize: 20,
                              fontWeight: 'bold',
                              color: '#333'
                            }
                          },
                          data: [
                            { value: data?.channelAnalysis?.summary?.self?.gmv || 0, name: '自有渠道' },
                            { value: data?.channelAnalysis?.summary?.third?.gmv || 0, name: '三方渠道' }
                          ]
                        }
                      ]
                    }}
                    style={{ height: 300 }}
                  />
               </Col>
               <Col span={16}>
                  <ReactECharts
                    option={{
                      title: { text: '大盘数据', left: 'center' },
                      tooltip: { trigger: 'axis' },
                      legend: { bottom: 0 },
                      grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
                      xAxis: { type: 'category', boundaryGap: false, data: data?.channelAnalysis?.trend?.dates || [] },
                      yAxis: { type: 'value' },
                      series: [
                        {
                          name: '自有渠道',
                          type: 'line',
                          stack: 'Total',
                          areaStyle: {},
                          emphasis: { focus: 'series' },
                          data: data?.channelAnalysis?.trend?.self || []
                        },
                        {
                          name: '三方渠道',
                          type: 'line',
                          stack: 'Total',
                          areaStyle: {},
                          emphasis: { focus: 'series' },
                          data: data?.channelAnalysis?.trend?.third || []
                        },
                        {
                          name: '自有渠道同期',
                          type: 'line',
                          lineStyle: { type: 'dashed' },
                          emphasis: { focus: 'series' },
                          data: data?.channelAnalysis?.trend?.prevSelf || []
                        },
                        {
                          name: '三方渠道同期',
                          type: 'line',
                          lineStyle: { type: 'dashed' },
                          emphasis: { focus: 'series' },
                          data: data?.channelAnalysis?.trend?.prevThird || []
                        }
                      ]
                    }}
                    style={{ height: 300 }}
                  />
               </Col>
             </Row>
          </Card>
        )}

        {scope === 'all' && (
        <Row gutter={24}>
          {/* Platform Performance */}
          <Col span={12}>
            <Card title="各平台表现" loading={loading}>
               <Table
                 columns={platformColumns}
                 dataSource={data?.platforms || []}
                 rowKey="platform"
                 pagination={false}
                 size="small"
               />
            </Card>
          </Col>

          {/* Device Ranking */}
          <Col span={12}>
            <Card title="热销设备 Top 10" loading={loading}>
               <Table
                 columns={deviceColumns}
                 dataSource={data?.devices || data?.products || []}
                 rowKey="deviceName"
                 pagination={false}
                 size="small"
               />
            </Card>
          </Col>
        </Row>
        )}

        {scope === 'self' && (
        <Card title="热销设备 Top 10" style={{ marginBottom: 24 }} loading={loading}>
           <Table
             columns={deviceColumns}
             dataSource={data?.devices || data?.products || []}
             rowKey="deviceName"
             pagination={false}
             size="small"
           />
        </Card>
        )}
      </div>
    </MainLayout>
  );
};

export default ReportsPage;

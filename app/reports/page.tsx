
'use client';
import React, { useState } from 'react';
import { Breadcrumb, theme, Card, Row, Col, Statistic, Radio, Table, Space, Tooltip, Empty } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, InfoCircleOutlined } from '@ant-design/icons';
import useSWR from 'swr';
import MainLayout from '../components/MainLayout';
import ReactECharts from 'echarts-for-react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const ReportsPage: React.FC = () => {
  const [period, setPeriod] = useState<'week' | 'biweek' | 'month'>('week');
  
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const { data, isLoading } = useSWR(`/api/reports?period=${period}`, fetcher);

  const renderGrowth = (value: number) => {
    const isPositive = value >= 0;
    return (
      <span style={{ color: isPositive ? '#3f8600' : '#cf1322', fontSize: 14 }}>
        {isPositive ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
        {Math.abs(value).toFixed(2)}%
      </span>
    );
  };

  // Chart Configuration
  const getTrendOption = () => {
    if (!data?.trend) return {};
    
    return {
      title: {
        text: '趋势对比 (本期 vs 上期)',
        left: 'center'
      },
      tooltip: {
        trigger: 'axis'
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
        data: data.trend.dates // e.g., ["Day 1", "Day 2", ...]
      },
      yAxis: {
        type: 'value'
      },
      series: [
        {
          name: '本期',
          type: 'line',
          data: data.trend.current,
          smooth: true,
          areaStyle: { opacity: 0.1 },
          itemStyle: { color: '#1890ff' }
        },
        {
          name: '上期',
          type: 'line',
          data: data.trend.previous,
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
      sorter: (a: any, b: any) => a.orderCount - b.orderCount,
    },
    {
      title: '销售额 (GMV)',
      dataIndex: 'gmv',
      key: 'gmv',
      render: (val: number) => `¥${val.toFixed(2)}`,
      sorter: (a: any, b: any) => a.gmv - b.gmv,
    },
    {
      title: '客单价 (AOV)',
      key: 'aov',
      render: (_: any, record: any) => `¥${(record.gmv / (record.orderCount || 1)).toFixed(2)}`,
    },
    {
      title: '占比',
      dataIndex: 'percentage',
      key: 'percentage',
      render: (val: number) => `${val.toFixed(1)}%`,
    }
  ];

  // Product Table Columns
  const productColumns = [
    {
      title: '排名',
      key: 'rank',
      width: 60,
      render: (_: any, __: any, index: number) => index + 1,
    },
    {
      title: '商品名称',
      dataIndex: 'productName',
      key: 'productName',
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
      render: (val: number) => `¥${val.toFixed(2)}`,
    }
  ];

  return (
    <MainLayout>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Breadcrumb style={{ margin: '16px 0' }} items={[{ title: '数据报表' }, { title: '报表概览' }]} />
        <Radio.Group value={period} onChange={(e) => setPeriod(e.target.value)} buttonStyle="solid">
          <Radio.Button value="week">周报 (近7天)</Radio.Button>
          <Radio.Button value="biweek">双周报 (近14天)</Radio.Button>
          <Radio.Button value="month">月报 (近30天)</Radio.Button>
        </Radio.Group>
      </div>
      
      <div style={{ padding: 24, minHeight: 360, background: colorBgContainer, borderRadius: borderRadiusLG }}>
        {/* Scorecard */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <Card loading={isLoading}>
              <Statistic 
                title="总销售额 (GMV)" 
                value={data?.summary?.gmv} 
                precision={2} 
                prefix="¥"
                suffix={renderGrowth(data?.summary?.gmvGrowth || 0)}
              />
              <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                上期: ¥{data?.summary?.prevGmv?.toFixed(2) || 0}
              </div>
            </Card>
          </Col>
          <Col span={6}>
            <Card loading={isLoading}>
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
          <Col span={6}>
            <Card loading={isLoading}>
              <Statistic 
                title="客单价 (AOV)" 
                value={data?.summary?.aov} 
                precision={2} 
                prefix="¥"
                suffix={renderGrowth(data?.summary?.aovGrowth || 0)}
              />
               <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                上期: ¥{data?.summary?.prevAov?.toFixed(2) || 0}
              </div>
            </Card>
          </Col>
          <Col span={6}>
            <Card loading={isLoading}>
              <Statistic 
                title={
                    <Space>
                        退款/取消率
                        <Tooltip title="包括已关闭(CLOSED)和归还中(RETURNING)的订单">
                            <InfoCircleOutlined style={{ fontSize: 14, color: '#999' }} />
                        </Tooltip>
                    </Space>
                } 
                value={data?.summary?.refundRate} 
                precision={2} 
                suffix="%"
                valueStyle={{ color: (data?.summary?.refundRate || 0) > 10 ? '#cf1322' : '#3f8600' }}
              />
              <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                上期: {data?.summary?.prevRefundRate?.toFixed(2) || 0}%
              </div>
            </Card>
          </Col>
        </Row>

        {/* Trend Chart */}
        <Card title="趋势对比" style={{ marginBottom: 24 }} loading={isLoading}>
          {data?.trend ? (
             <ReactECharts option={getTrendOption()} style={{ height: 350 }} />
          ) : <Empty />}
        </Card>

        <Row gutter={24}>
          {/* Platform Performance */}
          <Col span={12}>
            <Card title="各平台表现" loading={isLoading}>
               <Table 
                 columns={platformColumns} 
                 dataSource={data?.platforms || []} 
                 rowKey="platform" 
                 pagination={false}
                 size="small"
               />
            </Card>
          </Col>
          
          {/* Product Ranking */}
          <Col span={12}>
            <Card title="热销商品 Top 10" loading={isLoading}>
               <Table 
                 columns={productColumns} 
                 dataSource={data?.products || []} 
                 rowKey="productName" 
                 pagination={false}
                 size="small"
               />
            </Card>
          </Col>
        </Row>
      </div>
    </MainLayout>
  );
};

export default ReportsPage;

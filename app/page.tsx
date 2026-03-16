'use client';
import React, { useState } from 'react';
import { Card, Row, Col, Statistic, Radio, Tooltip, Space, theme, Breadcrumb } from 'antd';
import useSWR from 'swr';
import PlatformTrendChart from './components/Charts/PlatformTrendChart';
import PlatformTrendGrid from './components/Charts/PlatformTrendGrid';
import { InfoCircleOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import MainLayout from './components/MainLayout';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const App: React.FC = () => {
  const [dimension, setDimension] = useState<'day' | 'week' | 'month'>('day');
  const [metric, setMetric] = useState<'gmv' | 'order'>('order'); // 'gmv' | 'order'

  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  // Fetch Summary Data
  const { data: summary, isLoading: isSummaryLoading } = useSWR('/api/dashboard/summary', fetcher);
  
  // Fetch Platform Trend Data
  const { data: platformTrend, isLoading: isPlatformTrendLoading } = useSWR(`/api/dashboard/platform-trend?days=${dimension}`, fetcher);

  // Transform Data for Chart based on metric
  const chartData = React.useMemo(() => {
    if (!platformTrend) return { data: [], platforms: [] };
    
    const { data, platforms, totals } = platformTrend;
    const newData = data.map((item: any) => {
      const newItem: any = { date: item.date };
      platforms.forEach((p: string) => {
        newItem[p] = metric === 'gmv' ? item[`${p}_gmv`] : item[`${p}_count`];
      });
      return newItem;
    });
    
    return { data: newData, platforms, totals };
  }, [platformTrend, metric]);

  // Calculate Growth Rate
  const calculateGrowth = (current: number, previous: number) => {
    if (!previous) return 0;
    return ((current - previous) / previous) * 100;
  };

  const gmvGrowth = calculateGrowth(summary?.totalGMV || 0, summary?.recentGMV || 0);
  const orderGrowth = calculateGrowth(summary?.totalOrders || 0, summary?.recentOrders || 0);

  const renderGrowth = (value: number) => {
    const isPositive = value >= 0;
    return (
      <span style={{ color: isPositive ? '#3f8600' : '#cf1322', fontSize: 14 }}>
        {isPositive ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
        {Math.abs(value).toFixed(2)}%
      </span>
    );
  };

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
        <Row gutter={16}>
          <Col span={8}>
            <Card loading={isSummaryLoading}>
              <Statistic 
                title={
                    <Space>
                        总销售额 (GMV)
                        <Tooltip title="较前30天增长">
                            <InfoCircleOutlined style={{ fontSize: 14, color: '#999' }} />
                        </Tooltip>
                    </Space>
                }
                value={summary?.totalGMV} 
                precision={2} 
                prefix="¥" 
                suffix={
                    <Tooltip title={`前30天: ¥${summary?.recentGMV?.toFixed(2) || 0}`}>
                        {renderGrowth(gmvGrowth)}
                    </Tooltip>
                }
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card loading={isSummaryLoading}>
              <Statistic 
                title={
                    <Space>
                        总订单数
                        <Tooltip title="较前30天增长">
                            <InfoCircleOutlined style={{ fontSize: 14, color: '#999' }} />
                        </Tooltip>
                    </Space>
                }
                value={summary?.totalOrders} 
                suffix={
                    <Tooltip title={`前30天: ${summary?.recentOrders || 0}`}>
                        {renderGrowth(orderGrowth)}
                    </Tooltip>
                }
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card loading={isSummaryLoading}>
              <Statistic title="活跃推广员" value={summary?.activePromoters} />
            </Card>
          </Col>
        </Row>
        
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

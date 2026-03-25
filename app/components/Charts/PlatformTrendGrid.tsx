import React from 'react';
import ReactECharts from 'echarts-for-react';
import { Card, Col, Empty, Row, Statistic, Tooltip } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, InfoCircleOutlined } from '@ant-design/icons';
import type { PlatformTrendViewData } from './types';

interface PlatformTrendGridProps {
  data: PlatformTrendViewData;
  loading: boolean;
  metric: 'gmv' | 'order';
}

const toNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const gridEmptyStyle: React.CSSProperties = { margin: '8px 0' };
const gridLoadingCardStyle: React.CSSProperties = { height: 188 };
const gridLoadingCardBodyStyle: React.CSSProperties = { padding: '20px 24px 8px' };

const PlatformTrendGrid: React.FC<PlatformTrendGridProps> = ({ data, loading, metric }) => {
  const formatValue = (value: number) => {
    if (metric === 'gmv') {
      return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return value.toLocaleString('zh-CN');
  };
  if (loading) {
    return (
      <Row gutter={[16, 16]}>
        {[1, 2, 3, 4].map((i) => (
          <Col xs={24} sm={12} md={8} lg={6} key={i}>
            <Card size="small" loading={true} style={gridLoadingCardStyle} styles={{ body: gridLoadingCardBodyStyle }} />
          </Col>
        ))}
      </Row>
    );
  }

  if (!data || !data.platforms || data.platforms.length === 0) {
    return <Empty description="暂无平台分项数据" style={gridEmptyStyle} />;
  }

  const { data: chartData, platforms, totals } = data;

  const calculateGrowth = (current: number, previous: number) => {
    if (!previous) return 0;
    return ((current - previous) / previous) * 100;
  };

  const renderGrowth = (value: number) => {
    const isPositive = value >= 0;
    return (
      <span style={{ color: isPositive ? '#cf1322' : '#3f8600', fontSize: 12, marginLeft: 4 }}>
        {isPositive ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
        {Math.abs(value).toFixed(2)}%
      </span>
    );
  };

  return (
    <Row gutter={[16, 16]}>
      {platforms.map((platform) => {
        const platformData = chartData.map((item) => toNumber(item[platform]));
        const total = platformData.reduce((a, b) => a + b, 0);
        const lastValue = toNumber(platformData[platformData.length - 1]);
        
        let comparisonNode = null;
        
        if (totals && totals[platform]) {
            const count = toNumber(totals[platform].count);
            const gmv = toNumber(totals[platform].gmv);
            const prevCount = toNumber(totals[platform].prevCount);
            const prevGmv = toNumber(totals[platform].prevGmv);
            const countGrowth = calculateGrowth(count, prevCount);
            const gmvGrowth = calculateGrowth(gmv, prevGmv);
            
            comparisonNode = (
                <div style={{ fontSize: 12 }}>
                    <div>订单量环比: {renderGrowth(countGrowth)} (前值: {prevCount.toLocaleString('zh-CN')})</div>
                    <div>销售额环比: {renderGrowth(gmvGrowth)} (前值: {formatValue(prevGmv)})</div>
                </div>
            );
        }

        const option = {
          tooltip: {
            trigger: 'axis',
            formatter: (params: Array<{ axisValueLabel?: string; value: number | string }>) => {
              const date = params[0]?.axisValueLabel || '';
              const value = toNumber(params[0]?.value);
              return `${date}: ${formatValue(value)}`;
            },
          },
          grid: {
            top: 10,
            bottom: 0,
            left: 0,
            right: 0,
            containLabel: false,
          },
          xAxis: {
            type: 'category',
            boundaryGap: false,
            data: chartData.map((item) => item.date),
            show: false,
          },
          yAxis: {
            type: 'value',
            show: false,
          },
          series: [
            {
              data: platformData,
              type: 'line',
              smooth: true,
              areaStyle: {
                opacity: 0.1,
              },
              lineStyle: {
                width: 2,
              },
              showSymbol: false,
            },
          ],
        };

        return (
          <Col xs={24} sm={12} md={8} lg={6} key={platform}>
            <Card styles={{ body: { padding: '20px 24px 8px' } }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Statistic 
                    title={platform} 
                    value={formatValue(lastValue)}
                    suffix={<span style={{ fontSize: 12, color: '#888' }}>最新</span>}
                  />
                  {comparisonNode && (
                      <Tooltip title={comparisonNode}>
                          <InfoCircleOutlined style={{ color: '#999', cursor: 'pointer', marginTop: 4 }} />
                      </Tooltip>
                  )}
              </div>
              <div style={{ marginTop: 8, height: 60 }}>
                <ReactECharts 
                  option={option} 
                  style={{ height: '100%', width: '100%' }} 
                  opts={{ renderer: 'svg' }}
                />
              </div>
              <div style={{ marginTop: 8, borderTop: '1px solid #f0f0f0', paddingTop: 8, fontSize: 12, color: '#888' }}>
                本期总计: {formatValue(total)}
              </div>
            </Card>
          </Col>
        );
      })}
    </Row>
  );
};

export default PlatformTrendGrid;

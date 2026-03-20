import React from 'react';
import ReactECharts from 'echarts-for-react';
import { Card, Col, Row, Statistic, Tooltip } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, InfoCircleOutlined } from '@ant-design/icons';
import type { PlatformTrendViewData } from './types';

interface PlatformTrendGridProps {
  data: PlatformTrendViewData;
  loading: boolean;
}

const toNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const PlatformTrendGrid: React.FC<PlatformTrendGridProps> = ({ data, loading }) => {
  if (loading) {
    return (
      <Row gutter={[16, 16]}>
        {[1, 2, 3, 4].map((i) => (
          <Col span={6} key={i}>
            <Card loading={true} style={{ height: 200 }} />
          </Col>
        ))}
      </Row>
    );
  }

  if (!data || !data.platforms || data.platforms.length === 0) {
    return null;
  }

  const { data: chartData, platforms, totals } = data;

  const calculateGrowth = (current: number, previous: number) => {
    if (!previous) return 0;
    return ((current - previous) / previous) * 100;
  };

  const renderGrowth = (value: number) => {
    const isPositive = value >= 0;
    return (
      <span style={{ color: isPositive ? '#3f8600' : '#cf1322', fontSize: 12, marginLeft: 4 }}>
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
                    <div>订单量环比: {renderGrowth(countGrowth)} (前值: {prevCount})</div>
                    <div>销售额环比: {renderGrowth(gmvGrowth)} (前值: ¥{prevGmv.toFixed(2)})</div>
                </div>
            );
        }

        const option = {
          tooltip: {
            trigger: 'axis',
            formatter: '{b0}: {c0}',
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
                    value={lastValue} 
                    suffix={<span style={{ fontSize: 12, color: '#888' }}>今日</span>}
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
                本期总计: {total.toFixed(0) === total.toString() ? total : total.toFixed(2)}
              </div>
            </Card>
          </Col>
        );
      })}
    </Row>
  );
};

export default PlatformTrendGrid;

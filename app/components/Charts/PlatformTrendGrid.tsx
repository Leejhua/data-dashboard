import React from 'react';
import ReactECharts from 'echarts-for-react';
import { Card, Col, Row, Statistic, Tooltip } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, InfoCircleOutlined } from '@ant-design/icons';

interface PlatformTrendGridProps {
  data: {
    data: any[];
    platforms: string[];
    totals?: Record<string, { count: number; gmv: number; prevCount: number; prevGmv: number }>;
  };
  loading: boolean;
}

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
        const platformData = chartData.map((item) => item[platform] || 0);
        const total = platformData.reduce((a, b) => a + b, 0);
        const lastValue = platformData[platformData.length - 1];
        
        // Calculate growth if totals available
        let growthNode = null;
        let comparisonNode = null;
        
        if (totals && totals[platform]) {
            // Determine if we are showing GMV or Order Count based on heuristic
            // If total matches gmv in totals, then it's GMV mode
            // But chartData values might be slightly different due to aggregation buckets? No, should be exact sum.
            // Wait, `total` here is sum of chart points.
            // `totals[platform].gmv` is total GMV for the period.
            // Let's use `totals` for display as it is more accurate from source.
            
            // Actually, we don't know if `data` passed here is GMV or Count (it's transformed in parent).
            // We can guess by checking if values are integers? No, prices can be integers.
            // We can't know for sure without prop.
            // BUT, we can calculate growth for BOTH and just display the one that matches the current data magnitude?
            // Or better: Pass `metric` prop to this component.
            // For now, let's assume `total` approximates one of them.
            
            // Simplified approach: Just calculate growth of `total` vs `prevTotal` (which we don't have directly for the *chart* metric).
            // We have `totals[platform].prevCount` and `prevGmv`.
            // We need to know which one to compare against.
            
            // Let's just use the `totals` object to calculate both, and display both in tooltip?
            // Or better, let parent pass the growth value?
            // Parent has `metric` state.
            
            // Since we can't easily change prop signature without updating parent (which we can do),
            // let's try to infer or just show both in tooltip.
            
            const { count, gmv, prevCount, prevGmv } = totals[platform];
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

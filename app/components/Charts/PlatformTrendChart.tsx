import React from 'react';
import ReactECharts from 'echarts-for-react';
import { Empty, Spin } from 'antd';
import type { PlatformTrendViewData } from './types';

interface PlatformTrendChartProps {
  data: PlatformTrendViewData;
  loading: boolean;
  metric: 'gmv' | 'order';
}

interface TrendTooltipParam {
  dataIndex: number;
  seriesName: string;
  marker: string;
  value: number | string;
  color: string;
}

const chartEmptyStyle: React.CSSProperties = { margin: '8px 0' };
const chartFrameStyle: React.CSSProperties = { height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' };

const PlatformTrendChart: React.FC<PlatformTrendChartProps> = ({ data, loading, metric }) => {
  const formatValue = (value: number) => {
    if (metric === 'gmv') {
      return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return value.toLocaleString('zh-CN');
  };
  if (loading) {
    return (
      <div style={chartFrameStyle}>
        <Spin size="large" />
      </div>
    );
  }

  if (!data || !data.data || data.data.length === 0) {
    return (
      <div style={chartFrameStyle}>
        <Empty description="暂无趋势数据" style={chartEmptyStyle} />
      </div>
    );
  }

  const { data: chartData, platforms } = data;

  const option = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: TrendTooltipParam[]) => {
        if (!params || params.length === 0) return '';
        const dataIndex = params[0].dataIndex;
        const currentItem = chartData[dataIndex];
        const prevItem = dataIndex > 0 ? chartData[dataIndex - 1] : null;
        const date = currentItem.date;

        let html = `<div style="font-weight: bold; margin-bottom: 8px;">${date}</div>`;
        
        params.forEach((param) => {
            const platformName = param.seriesName;
            const value = Number(param.value || 0);
            const color = param.color;
            
            let growthStr = '';
            if (prevItem) {
                const prevValue = Number(prevItem[platformName] || 0);
                if (prevValue) {
                    const growth = ((value - prevValue) / prevValue) * 100;
                    const isPositive = growth >= 0;
                    const growthColor = isPositive ? '#cf1322' : '#3f8600';
                    const icon = isPositive ? '▲' : '▼';
                    // Only show growth if absolute value is >= 0.1% to avoid noise
                    if (Math.abs(growth) >= 0.1) {
                        growthStr = `<span style="color: ${growthColor}; margin-left: 8px; font-size: 12px;">${icon} ${Math.abs(growth).toFixed(1)}%</span>`;
                    }
                } else if (value > 0) {
                     growthStr = `<span style="color: #cf1322; margin-left: 8px; font-size: 12px;">New</span>`;
                }
            }

            html += `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span style="margin-right: 16px;">
                        <span style="display:inline-block;margin-right:6px;border-radius:10px;width:10px;height:10px;background-color:${color};"></span>
                        ${platformName}
                    </span>
                    <span>
                        <span style="font-weight: bold;">${formatValue(value)}</span>
                        ${growthStr}
                    </span>
                </div>
            `;
        });
        return html;
      }
    },
    legend: {
      data: platforms,
      bottom: 0,
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '10%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: chartData.map((item) => item.date),
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (value: number) => (metric === 'gmv' ? `¥${value}` : `${value}`),
      },
    },
    series: platforms.map((platform) => ({
      name: platform,
      type: 'line',
      data: chartData.map((item) => Number(item[platform] || 0)),
      smooth: true,
    })),
  };

  return <ReactECharts option={option} style={{ height: 400 }} />;
};

export default PlatformTrendChart;

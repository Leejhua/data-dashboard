'use client';
import React from 'react';
import ReactECharts from 'echarts-for-react';

interface SalesChartProps {
  data: {
    date: string;
    gmv: number;
    orderCount: number;
  }[];
  loading?: boolean;
}

const SalesChart: React.FC<SalesChartProps> = ({ data, loading }) => {
  const option = {
    title: {
      text: 'GMV 趋势',
      left: 'center'
    },
    tooltip: {
      trigger: 'axis'
    },
    xAxis: {
      type: 'category',
      data: data.map(item => item.date)
    },
    yAxis: {
      type: 'value'
    },
    series: [
      {
        data: data.map(item => item.gmv),
        type: 'line',
        smooth: true,
        itemStyle: { color: '#1890ff' },
        areaStyle: { color: 'rgba(24, 144, 255, 0.2)' }
      }
    ]
  };

  return <ReactECharts option={option} style={{ height: '300px' }} showLoading={loading} />;
};

export default SalesChart;

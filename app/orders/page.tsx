'use client';
import React, { useState } from 'react';
import { Breadcrumb, theme, Table, Card, Form, Input, Select, Button, DatePicker, Tag, Space, Tabs, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import useSWR from 'swr';
import { SearchOutlined, ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import MainLayout from '../components/MainLayout';

const { RangePicker } = DatePicker;
const { Text } = Typography;

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface Order {
  id: string;
  orderNo: string;
  platform: string;
  status: string;
  totalAmount: number;
  productName: string;
  promoter?: { name: string };
  createdAt: string;
  recipientName?: string;
  recipientPhone?: string;
  address?: string;
  trackingNumber?: string;
  // Online Order fields
  merchantName?: string;
  itemSku?: string;
}

const OrdersPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState('offline'); // 'offline' | 'online'
  const [activePlatform, setActivePlatform] = useState('ALL'); // For online orders sub-tab
  
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  // Search State
  const [filters, setFilters] = useState({
    page: 1,
    pageSize: 10,
    orderNo: '',
    status: '',
    platform: '',
    startDate: '',
    endDate: '',
  });

  const [form] = Form.useForm();

  // Build Query String
  const queryString = new URLSearchParams({
    page: filters.page.toString(),
    pageSize: filters.pageSize.toString(),
    ...(filters.orderNo && { orderNo: filters.orderNo }),
    ...(filters.status && { status: filters.status }),
    // If online tab and specific platform selected, use that. Otherwise use filter value.
    ...(activeTab === 'online' && activePlatform !== 'ALL' ? { platform: activePlatform } : (filters.platform && { platform: filters.platform })),
    ...(filters.startDate && { startDate: filters.startDate }),
    ...(filters.endDate && { endDate: filters.endDate }),
  }).toString();

  const apiUrl = activeTab === 'online' ? '/api/online-orders' : '/api/orders';
  const { data, isLoading, mutate } = useSWR(`${apiUrl}?${queryString}`, fetcher);

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    setFilters({ ...filters, page: 1 }); // Reset page on tab change
    // Reset platform filter when switching main tabs
    if (key === 'offline') {
      setActivePlatform('ALL');
    }
  };

  const handlePlatformChange = (key: string) => {
    setActivePlatform(key);
    setFilters({ ...filters, page: 1 });
  };

  const handleSearch = (values: any) => {
    const { dateRange, ...rest } = values;
    setFilters({
      ...filters,
      ...rest,
      startDate: dateRange ? dateRange[0].format('YYYY-MM-DD') : '',
      endDate: dateRange ? dateRange[1].format('YYYY-MM-DD') : '',
      page: 1, // Reset to first page on search
    });
  };

  const handleReset = () => {
    form.resetFields();
    setFilters({
      page: 1,
      pageSize: 10,
      orderNo: '',
      status: '',
      platform: '',
      startDate: '',
      endDate: '',
    });
  };

  const handleTableChange = (pagination: any) => {
    setFilters({
      ...filters,
      page: pagination.current,
      pageSize: pagination.pageSize,
    });
  };

  const handleExport = () => {
    // Redirect to export API to download file
    const exportQueryString = new URLSearchParams({
      ...(filters.orderNo && { orderNo: filters.orderNo }),
      ...(filters.status && { status: filters.status }),
      ...(filters.platform && { platform: filters.platform }),
      ...(filters.startDate && { startDate: filters.startDate }),
      ...(filters.endDate && { endDate: filters.endDate }),
    }).toString();
    
    // TODO: Support online order export if needed. Currently default to offline orders export.
    window.location.href = `/api/orders/export?${exportQueryString}`;
  };

  const offlineColumns: ColumnsType<Order> = [
    {
      title: '订单号',
      dataIndex: 'orderNo',
      key: 'orderNo',
      width: 180,
      render: (text) => <Text copyable>{text}</Text>,
    },
    {
      title: '商品',
      dataIndex: 'productName',
      key: 'productName',
      ellipsis: true,
    },
    {
      title: '平台',
      dataIndex: 'platform',
      key: 'platform',
      width: 100,
      render: (text) => {
        if (!text) return <Tag>其他</Tag>;
        const upper = text.toUpperCase().trim();
        if (upper === 'XIANYU' || text === '闲鱼') return <Tag color="orange">闲鱼</Tag>;
        if (upper === 'OFFLINE') return <Tag color="blue">线下</Tag>;
        // Filter out numeric IDs or tracking numbers
        if (upper === 'UNKNOWN' || /^\d+$/.test(upper) || /^SF\d+$/.test(upper)) return <Tag color="default">其他</Tag>;
        return <Tag color="blue">{text}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => {
        const statusMap: Record<string, { text: string; color: string }> = {
          'COMPLETED': { text: '已完成', color: 'success' },
          'REFUNDED': { text: '已退款', color: 'error' },
          'PENDING': { text: '进行中', color: 'processing' },
          'CANCELED': { text: '已取消', color: 'default' },
          'PAID': { text: '已支付', color: 'processing' },
          'CLOSED': { text: '已关闭', color: 'default' },
          'PENDING_RECEIPT': { text: '待收货', color: 'blue' },
          'PENDING_REVIEW': { text: '待审核', color: 'orange' },
          'PENDING_SHIPMENT': { text: '待发货', color: 'cyan' },
          'RENTING': { text: '租赁中', color: 'geekblue' },
          'RETURNING': { text: '归还中', color: 'warning' },
          'SHIPPED_PENDING_CONFIRMATION': { text: '已发货', color: 'blue' },
          'BOUGHT_OUT': { text: '已买断', color: 'green' },
          'OVERDUE': { text: '已逾期', color: 'red' },
          'WAIT_PAY': { text: '待支付', color: 'processing' },
        };
        
        // Handle dirty data
        if (status && status.length > 20) return <Tag color="default">异常数据</Tag>;
        if (status === '54' || status === 'UNKNOWN') return <Tag color="default">未知</Tag>;

        const config = statusMap[status] || { text: status, color: 'default' };
        return <Tag color={config.color}>{config.text}</Tag>;
      },
    },
    {
      title: '金额',
      dataIndex: 'totalAmount',
      key: 'totalAmount',
      width: 100,
      render: (val) => `¥${val.toFixed(2)}`,
    },
    {
      title: '收件人',
      key: 'recipient',
      width: 150,
      render: (_, record) => (
        <Space orientation="vertical" size={0}>
          <span>{record.recipientName || '-'}</span>
          <span style={{ fontSize: 12, color: '#999' }}>{record.recipientPhone || '-'}</span>
        </Space>
      ),
    },
    {
      title: '地址',
      dataIndex: 'address',
      key: 'address',
      ellipsis: true,
    },
    {
      title: '物流单号',
      dataIndex: 'trackingNumber',
      key: 'trackingNumber',
      render: (text) => text ? <Text copyable>{text}</Text> : '-',
    },
    {
      title: '推广员',
      dataIndex: ['promoter', 'name'],
      key: 'promoter',
      width: 100,
      render: (text) => text || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (date) => dayjs(date).format('YYYY-MM-DD HH:mm'),
    },
  ];

  const onlineColumns: ColumnsType<Order> = [
    {
      title: '订单号',
      dataIndex: 'orderNo',
      key: 'orderNo',
      width: 180,
      render: (text) => <Text copyable>{text}</Text>,
    },
    {
      title: '商户',
      dataIndex: 'merchantName',
      key: 'merchantName',
      ellipsis: true,
    },
    {
      title: '商品',
      dataIndex: 'productName',
      key: 'productName',
      ellipsis: true,
      render: (text, record) => (
        <Space orientation="vertical" size={0}>
          <span>{text}</span>
          <span style={{ fontSize: 12, color: '#999' }}>SKU: {record.itemSku || '-'}</span>
        </Space>
      ),
    },
    {
      title: '平台',
      dataIndex: 'platform',
      key: 'platform',
      width: 100,
      render: (text) => {
        if (!text) return <Tag>其他</Tag>;
        const upper = text.toUpperCase().trim();
        const map: Record<string, string> = {
          'ZANCHEN': '赞晨',
          '零零享': '零零享',
          '优品租': '优品租',
          '奥租': '奥租',
          '诚赁': '诚赁',
          '人人租': '人人租',
          'XIANYU': '闲鱼',
        };
        // Handle weird data
        if (upper === 'UNKNOWN' || /^\d+$/.test(upper) || /^SF\d+$/.test(upper)) return <Tag color="default">其他</Tag>;
        
        return <Tag color="cyan">{map[upper] || map[text] || text}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => {
        const statusMap: Record<string, { text: string; color: string }> = {
          'COMPLETED': { text: '已完成', color: 'success' },
          'REFUNDED': { text: '已退款', color: 'error' },
          'PENDING': { text: '进行中', color: 'processing' },
          'CANCELED': { text: '已取消', color: 'default' },
          'PAID': { text: '已支付', color: 'processing' },
          'CLOSED': { text: '已关闭', color: 'default' },
          'PENDING_RECEIPT': { text: '待收货', color: 'blue' },
          'PENDING_REVIEW': { text: '待审核', color: 'orange' },
          'PENDING_SHIPMENT': { text: '待发货', color: 'cyan' },
          'RENTING': { text: '租赁中', color: 'geekblue' },
          'RETURNING': { text: '归还中', color: 'warning' },
          'SHIPPED_PENDING_CONFIRMATION': { text: '已发货', color: 'blue' },
          'BOUGHT_OUT': { text: '已买断', color: 'green' },
          'OVERDUE': { text: '已逾期', color: 'red' },
          'WAIT_PAY': { text: '待支付', color: 'processing' },
        };
        
        // Handle dirty data
        if (status && status.length > 20) return <Tag color="default">异常数据</Tag>;
        if (status === '54' || status === 'UNKNOWN') return <Tag color="default">未知</Tag>;

        const config = statusMap[status] || { text: status, color: 'default' };
        return <Tag color={config.color}>{config.text}</Tag>;
      },
    },
    {
      title: '金额',
      dataIndex: 'totalAmount',
      key: 'totalAmount',
      width: 100,
      render: (val) => `¥${val.toFixed(2)}`,
    },
    {
      title: '收件人',
      key: 'recipient',
      width: 150,
      render: (_, record) => (
        <Space orientation="vertical" size={0}>
          <span>{record.recipientName || '-'}</span>
          <span style={{ fontSize: 12, color: '#999' }}>{record.recipientPhone || '-'}</span>
        </Space>
      ),
    },
    {
      title: '物流',
      dataIndex: 'trackingNumber',
      key: 'trackingNumber',
      render: (text, record) => (
         <Space orientation="vertical" size={0}>
           <Text copyable>{text || '-'}</Text>
           <span style={{ fontSize: 12, color: '#999' }}>{(record as any).logisticsCompany || ''}</span>
         </Space>
      )
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (date) => dayjs(date).format('YYYY-MM-DD HH:mm'),
    },
  ];

  const columns = activeTab === 'online' ? onlineColumns : offlineColumns;

  return (
    <MainLayout>
      <Breadcrumb style={{ margin: '16px 0' }} items={[{ title: '订单管理' }, { title: '订单列表' }]} />
      
      <div style={{ padding: 24, minHeight: 360, background: colorBgContainer, borderRadius: borderRadiusLG }}>
        <Tabs 
          defaultActiveKey="offline" 
          activeKey={activeTab} 
          onChange={handleTabChange}
          items={[
            { key: 'offline', label: '线下订单' },
            { key: 'online', label: '线上订单' },
          ]}
          className="mb-4"
        />

        {activeTab === 'online' && (
          <Tabs
            activeKey={activePlatform}
            onChange={handlePlatformChange}
            type="card"
            className="mb-4"
            items={[
              { key: 'ALL', label: '全部' },
              { key: 'ZANCHEN', label: '赞晨' },
              { key: '奥租', label: '奥租' },
              { key: '零零享', label: '零零享' },
              { key: '优品租', label: '优品租' },
              { key: '诚赁', label: '诚赁' },
              { key: '人人租', label: '人人租' },
              { key: '支付宝小程序', label: '支付宝小程序' },
            ]}
          />
        )}

        <Card variant="borderless" className="mb-4">
          <Form form={form} layout="inline" onFinish={handleSearch}>
            <Form.Item name="orderNo" label="订单号">
              <Input placeholder="输入订单号" allowClear />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select placeholder="选择状态" allowClear style={{ width: 120 }}>
                <Select.Option value="COMPLETED">已完成</Select.Option>
                <Select.Option value="REFUNDED">已退款</Select.Option>
                <Select.Option value="PENDING">进行中</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item name="dateRange" label="创建时间">
              <RangePicker />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
                  查询
                </Button>
                <Button onClick={handleReset} icon={<ReloadOutlined />}>
                  重置
                </Button>
                <Button onClick={handleExport} icon={<DownloadOutlined />}>
                  导出 Excel
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>

        <Table
          columns={columns}
          dataSource={data?.data}
          loading={isLoading}
          rowKey="id"
          pagination={{
            current: filters.page,
            pageSize: filters.pageSize,
            total: data?.pagination?.total,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
          onChange={handleTableChange}
        />
      </div>
    </MainLayout>
  );
};

export default OrdersPage;

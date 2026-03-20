'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { Breadcrumb, theme, Card, Table, Select, Button, Space, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import useSWR from 'swr';
import MainLayout from '../components/MainLayout';

const { Text } = Typography;

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string })?.error || `请求失败: ${res.status}`);
  }
  return body;
};

interface MappingProduct {
  id: string;
  name: string;
}

interface MappingSpec {
  id: string;
  specId: string;
  name: string;
  productId: string;
  productName: string;
  offlineOrderCount: number;
  onlineOrderCount: number;
  totalOrderCount: number;
}

interface MappingResponse {
  products: MappingProduct[];
  specs: MappingSpec[];
}

interface EditingMapping {
  productId: string;
}

const normalizeProducts = (products: unknown): MappingProduct[] => {
  if (!Array.isArray(products)) return [];
  return products
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        id: String(record?.id || '').trim(),
        name: String(record?.name || '').trim(),
      };
    })
    .filter((item) => item.id && item.name);
};

const normalizeSpecs = (specs: unknown): MappingSpec[] => {
  if (!Array.isArray(specs)) return [];
  return specs
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        id: String(record?.id || '').trim(),
        specId: String(record?.specId || '').trim(),
        name: String(record?.name || '').trim(),
        productId: String(record?.productId || '').trim(),
        productName: String(record?.productName || '').trim(),
        offlineOrderCount: Number(record?.offlineOrderCount || 0),
        onlineOrderCount: Number(record?.onlineOrderCount || 0),
        totalOrderCount: Number(record?.totalOrderCount || 0),
      };
    })
    .filter((item) => item.id);
};

const ProductMappingsPage: React.FC = () => {
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const { data, isLoading, mutate } = useSWR<MappingResponse>('/api/product-mappings', fetcher);
  const [editingMap, setEditingMap] = useState<Record<string, EditingMapping>>({});
  const [savingId, setSavingId] = useState<string>('');
  const products = useMemo(() => normalizeProducts((data as unknown as Record<string, unknown> | undefined)?.products), [data]);
  const specs = useMemo(() => normalizeSpecs((data as unknown as Record<string, unknown> | undefined)?.specs), [data]);

  useEffect(() => {
    if (!specs.length) {
      setEditingMap({});
      return;
    }
    const nextState: Record<string, EditingMapping> = {};
    specs.forEach((item) => {
      nextState[item.id] = {
        productId: item.productId,
      };
    });
    setEditingMap(nextState);
  }, [specs]);

  const productOptions = useMemo(
    () =>
      products.map((item) => ({
        label: item.name,
        value: item.id,
      })),
    [products]
  );

  const productNameMap = useMemo(() => {
    const map = new Map<string, string>();
    products.forEach((item) => {
      map.set(item.id, item.name);
    });
    return map;
  }, [products]);

  const updateRow = (specId: string, updater: (prev: EditingMapping) => EditingMapping) => {
    setEditingMap((prev) => {
      const current = prev[specId];
      if (!current) return prev;
      return {
        ...prev,
        [specId]: updater(current),
      };
    });
  };

  const handleSave = async (productSpecId: string) => {
    const payload = editingMap[productSpecId];
    if (!payload) return;
    if (!payload.productId) {
      message.error('请选择设备后再保存');
      return;
    }
    setSavingId(productSpecId);
    try {
      const response = await fetch('/api/product-mappings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productSpecId,
          productId: payload.productId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '保存失败' }));
        throw new Error(errorData.error || '保存失败');
      }

      message.success('保存成功');
      await mutate();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSavingId('');
    }
  };

  const columns: ColumnsType<MappingSpec> = [
    {
      title: '规格编号',
      dataIndex: 'specId',
      key: 'specId',
      width: 220,
    },
    {
      title: '规格名称',
      dataIndex: 'name',
      key: 'name',
      width: 260,
    },
    {
      title: '当前设备',
      key: 'productName',
      width: 220,
      render: (_, record) => <Text>{record.productName}</Text>,
    },
    {
      title: '映射设备',
      key: 'mappingProduct',
      render: (_, record) => (
        <Select
          value={editingMap[record.id]?.productId || record.productId || undefined}
          onChange={(value) =>
            updateRow(record.id, (prev) => ({
              ...prev,
              productId: String(value),
            }))
          }
          options={productOptions}
          showSearch
          optionFilterProp="label"
          style={{ width: '100%' }}
          placeholder="选择设备"
        />
      ),
    },
    {
      title: '关联订单',
      key: 'orders',
      width: 180,
      render: (_, record) => <Text>{record.totalOrderCount}（线下 {record.offlineOrderCount} / 线上 {record.onlineOrderCount}）</Text>,
    },
    {
      title: '变更后设备',
      key: 'nextProductName',
      width: 220,
      render: (_, record) => <Text>{productNameMap.get(editingMap[record.id]?.productId || record.productId) || '-'}</Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Button type="primary" loading={savingId === record.id} onClick={() => handleSave(record.id)}>
          保存
        </Button>
      ),
    },
  ];

  return (
    <MainLayout>
      <Breadcrumb style={{ margin: '16px 0' }} items={[{ title: '映射管理' }, { title: '规格设备映射' }]} />
      <div style={{ padding: 24, minHeight: 360, background: colorBgContainer, borderRadius: borderRadiusLG }}>
        <Card
          title="规格到设备映射"
          variant="borderless"
          loading={isLoading}
          extra={<Space><Text type="secondary">关系：specId → Product，保存时同步订单 productId</Text></Space>}
        >
          <Table
            rowKey="id"
            columns={columns}
            dataSource={specs}
            pagination={{ pageSize: 20, showSizeChanger: true }}
          />
        </Card>
      </div>
    </MainLayout>
  );
};

export default ProductMappingsPage;

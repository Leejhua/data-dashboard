'use client';
import React from 'react';
import { Alert, Breadcrumb, Button, Card, Form, InputNumber, Space, Tag, Typography, message, theme } from 'antd';
import useSWR from 'swr';
import MainLayout from '../../../components/MainLayout';

interface ZulinAlertConfig {
  minManagedDays: number;
  maxExposure: number;
  maxVisitRate: number;
  weightExposure: number;
  weightVisitRate: number;
  weightManagedDays: number;
  minWarningScore: number;
  maxWarningItems: number;
  updatedAt: string;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string })?.error || `请求失败: ${res.status}`);
  }
  return body as ZulinAlertConfig;
};

const ZulinAlertConfigPage: React.FC = () => {
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();
  const [form] = Form.useForm<ZulinAlertConfig>();
  const [saving, setSaving] = React.useState(false);
  const { data, error, isLoading, mutate } = useSWR<ZulinAlertConfig>('/api/dashboard/zulin/alert-config', fetcher);

  React.useEffect(() => {
    if (!data) return;
    form.setFieldsValue({
      minManagedDays: data.minManagedDays,
      maxExposure: data.maxExposure,
      maxVisitRate: data.maxVisitRate,
      weightExposure: data.weightExposure,
      weightVisitRate: data.weightVisitRate,
      weightManagedDays: data.weightManagedDays,
      minWarningScore: data.minWarningScore,
      maxWarningItems: data.maxWarningItems,
    });
  }, [data, form]);

  const saveConfig = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const response = await fetch('/api/dashboard/zulin/alert-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((result as { error?: string })?.error || '保存失败');
      }
      message.success('预警配置已保存');
      await mutate();
    } catch (errorInfo) {
      if (errorInfo instanceof Error) {
        message.error(errorInfo.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const weightExposure = Number(Form.useWatch('weightExposure', form) || 0);
  const weightVisitRate = Number(Form.useWatch('weightVisitRate', form) || 0);
  const weightManagedDays = Number(Form.useWatch('weightManagedDays', form) || 0);
  const weightSum = weightExposure + weightVisitRate + weightManagedDays;

  return (
    <MainLayout>
      <Space direction="vertical" size={12} style={{ margin: '16px 0' }}>
        <Breadcrumb items={[{ title: '数据看板' }, { title: '芝麻租赁' }, { title: '预警配置' }]} />
        <Typography.Text type="secondary">用于控制预警商品筛选和评分排序，修改后会即时生效。</Typography.Text>
      </Space>
      <div style={{ padding: 24, minHeight: 360, background: colorBgContainer, borderRadius: borderRadiusLG }}>
        {error ? (
          <Alert type="error" showIcon message="加载预警配置失败" description={error instanceof Error ? error.message : '请稍后重试'} style={{ marginBottom: 16 }} />
        ) : null}
        <Card
          size="small"
          title={<Typography.Text strong>芝麻租赁预警评分配置</Typography.Text>}
          loading={isLoading}
          extra={
            <Space>
              <Tag color={Math.abs(weightSum - 1) < 0.001 ? 'success' : 'warning'}>权重和 {weightSum.toFixed(2)}</Tag>
              {data?.updatedAt ? <Tag color="default">上次更新：{new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false })}</Tag> : null}
            </Space>
          }
        >
          <Form form={form} layout="vertical">
            <Space size={16} wrap style={{ width: '100%' }}>
              <Form.Item label="最小托管天数" name="minManagedDays" rules={[{ required: true, message: '请输入最小托管天数' }]}>
                <InputNumber min={1} max={365} precision={0} style={{ width: 220 }} />
              </Form.Item>
              <Form.Item label="最大曝光阈值" name="maxExposure" rules={[{ required: true, message: '请输入最大曝光阈值' }]}>
                <InputNumber min={1} max={1000000} precision={0} style={{ width: 220 }} />
              </Form.Item>
              <Form.Item label="最大访问率阈值(%)" name="maxVisitRate" rules={[{ required: true, message: '请输入最大访问率阈值' }]}>
                <InputNumber min={0.1} max={100} precision={2} style={{ width: 220 }} />
              </Form.Item>
              <Form.Item label="预警分下限" name="minWarningScore" rules={[{ required: true, message: '请输入预警分下限' }]}>
                <InputNumber min={0} max={100} precision={2} style={{ width: 220 }} />
              </Form.Item>
              <Form.Item label="预警商品上限" name="maxWarningItems" rules={[{ required: true, message: '请输入预警商品上限' }]}>
                <InputNumber min={1} max={200} precision={0} style={{ width: 220 }} />
              </Form.Item>
            </Space>
            <Space size={16} wrap style={{ width: '100%' }}>
              <Form.Item label="曝光风险权重" name="weightExposure" rules={[{ required: true, message: '请输入曝光风险权重' }]}>
                <InputNumber min={0} max={1} step={0.01} precision={2} style={{ width: 220 }} />
              </Form.Item>
              <Form.Item label="访问率风险权重" name="weightVisitRate" rules={[{ required: true, message: '请输入访问率风险权重' }]}>
                <InputNumber min={0} max={1} step={0.01} precision={2} style={{ width: 220 }} />
              </Form.Item>
              <Form.Item label="托管时长权重" name="weightManagedDays" rules={[{ required: true, message: '请输入托管时长权重' }]}>
                <InputNumber min={0} max={1} step={0.01} precision={2} style={{ width: 220 }} />
              </Form.Item>
            </Space>
            <Typography.Text type="secondary">
              当前预警逻辑：托管天数 ≥ 最小托管天数 且 曝光 ≤ 最大曝光阈值，按复合评分排序并筛选预警分下限，最多返回预警商品上限条。
            </Typography.Text>
            <div style={{ marginTop: 16 }}>
              <Button type="primary" loading={saving} onClick={saveConfig}>
                保存配置
              </Button>
            </div>
          </Form>
        </Card>
      </div>
    </MainLayout>
  );
};

export default ZulinAlertConfigPage;

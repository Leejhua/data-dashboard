'use client';
import React from 'react';
import { Alert, Breadcrumb, Button, Card, DatePicker, Form, Input, InputNumber, Space, Tag, Typography, Upload, message, theme } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import useSWR from 'swr';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import type { UploadProps } from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
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

type CsvRow = string[];
type ParsedCsv = {
  headers: string[];
  rows: CsvRow[];
};

type IngestItem = {
  id: string;
  title: string;
  exposure?: string | number;
  visits?: string | number;
  amount?: string | number;
  price?: string;
  managed_days?: string | number;
  scope?: string;
  start_date?: string;
  end_date?: string;
  optimization?: string;
};

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
  const [importing, setImporting] = React.useState(false);
  const [importDate, setImportDate] = React.useState<Dayjs>(dayjs());
  const [csvText, setCsvText] = React.useState('');
  const [uploadFiles, setUploadFiles] = React.useState<UploadFile[]>([]);
  const [importResult, setImportResult] = React.useState<{
    batchId: string;
    payloadCount: number;
    insertedCount: number;
    updatedCount: number;
    failedCount: number;
  } | null>(null);
  const [batchImportResult, setBatchImportResult] = React.useState<{
    fileCount: number;
    payloadCount: number;
    insertedCount: number;
    updatedCount: number;
    failedCount: number;
  } | null>(null);
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

  const normalizeHeader = (value: string) => {
    return value.replace(/\uFEFF/g, '').replace(/\s+/g, '').toLowerCase();
  };

  const parseCsv = (text: string): ParsedCsv => {
    const rows: CsvRow[] = [];
    let current = '';
    let row: string[] = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (char === ',' && !inQuotes) {
        row.push(current);
        current = '';
        continue;
      }
      if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && next === '\n') {
          i += 1;
        }
        row.push(current);
        current = '';
        if (row.some((cell) => String(cell || '').trim() !== '')) {
          rows.push(row.map((cell) => String(cell || '').trim()));
        }
        row = [];
        continue;
      }
      current += char;
    }
    row.push(current);
    if (row.some((cell) => String(cell || '').trim() !== '')) {
      rows.push(row.map((cell) => String(cell || '').trim()));
    }
    if (!rows.length) {
      return { headers: [], rows: [] };
    }
    const headers = rows[0].map((cell) => normalizeHeader(cell));
    return { headers, rows: rows.slice(1) };
  };

  const pickValue = (headers: string[], row: CsvRow, aliases: string[]) => {
    for (const alias of aliases) {
      const idx = headers.indexOf(normalizeHeader(alias));
      if (idx >= 0 && idx < row.length) {
        return String(row[idx] || '').trim();
      }
    }
    return '';
  };

  const buildIngestItems = (parsed: ParsedCsv) => {
    const items: IngestItem[] = [];
    for (const row of parsed.rows) {
      const id = pickValue(parsed.headers, row, ['商品id', '商品ID', 'product_id', 'id']);
      const title = pickValue(parsed.headers, row, ['商品标题', '标题', 'title']);
      if (!id || !title) {
        continue;
      }
      items.push({
        id,
        title,
        exposure: pickValue(parsed.headers, row, ['曝光次数', '曝光', 'exposure']),
        visits: pickValue(parsed.headers, row, ['商品访问次数', '访问次数', '访问', 'visits']),
        amount: pickValue(parsed.headers, row, ['交易金额(元)', '交易金额', 'amount']),
        price: pickValue(parsed.headers, row, ['商品租金', '租金', 'price']),
        managed_days: pickValue(parsed.headers, row, ['托管天数', 'managed_days']),
        scope: pickValue(parsed.headers, row, ['托管范围', 'scope']),
        start_date: pickValue(parsed.headers, row, ['托管起始日期', 'start_date']),
        end_date: pickValue(parsed.headers, row, ['托管到期日期', 'end_date']),
        optimization: pickValue(parsed.headers, row, ['优化中', '优化状态', 'optimization']),
      });
    }
    return items;
  };

  const importCsv = async () => {
    const raw = csvText.trim();
    if (!raw) {
      message.warning('请先粘贴CSV内容或上传CSV文件');
      return;
    }
    const parsed = parseCsv(raw);
    const items = buildIngestItems(parsed);
    if (!items.length) {
      message.error('未识别到有效数据，请确认包含“商品ID/商品标题”等列');
      return;
    }
    try {
      setImporting(true);
      setImportResult(null);
      const response = await fetch('/api/dashboard/zulin/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: importDate.format('YYYY-MM-DD'),
          source: 'manual_csv',
          items,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((result as { error?: string })?.error || '导入失败');
      }
      setImportResult({
        batchId: String((result as { batchId?: string }).batchId || ''),
        payloadCount: Number((result as { payloadCount?: number }).payloadCount || 0),
        insertedCount: Number((result as { insertedCount?: number }).insertedCount || 0),
        updatedCount: Number((result as { updatedCount?: number }).updatedCount || 0),
        failedCount: Number((result as { failedCount?: number }).failedCount || 0),
      });
      message.success(`导入完成，共 ${items.length} 条`);
    } catch (errorInfo) {
      message.error(errorInfo instanceof Error ? errorInfo.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const extractDateFromFileName = (fileName: string) => {
    const matches = fileName.match(/\d{4}-\d{2}-\d{2}/g) || [];
    if (!matches.length) {
      return importDate.format('YYYY-MM-DD');
    }
    return matches[0];
  };

  const importCsvFiles = async () => {
    if (!uploadFiles.length) {
      message.warning('请先选择CSV文件');
      return;
    }
    try {
      setImporting(true);
      setImportResult(null);
      setBatchImportResult(null);
      let payloadCount = 0;
      let insertedCount = 0;
      let updatedCount = 0;
      let failedCount = 0;
      let successFileCount = 0;
      for (const uploadFile of uploadFiles) {
        const rawFile = uploadFile.originFileObj;
        if (!rawFile) {
          continue;
        }
        const raw = (await rawFile.text()).trim();
        if (!raw) {
          continue;
        }
        const parsed = parseCsv(raw);
        const items = buildIngestItems(parsed);
        if (!items.length) {
          continue;
        }
        const response = await fetch('/api/dashboard/zulin/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: extractDateFromFileName(uploadFile.name),
            source: 'manual_csv_batch',
            items,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error((result as { error?: string })?.error || `导入失败：${uploadFile.name}`);
        }
        payloadCount += Number((result as { payloadCount?: number }).payloadCount || 0);
        insertedCount += Number((result as { insertedCount?: number }).insertedCount || 0);
        updatedCount += Number((result as { updatedCount?: number }).updatedCount || 0);
        failedCount += Number((result as { failedCount?: number }).failedCount || 0);
        successFileCount += 1;
      }
      setBatchImportResult({
        fileCount: successFileCount,
        payloadCount,
        insertedCount,
        updatedCount,
        failedCount,
      });
      message.success(`批量导入完成，共处理 ${successFileCount} 个文件`);
    } catch (errorInfo) {
      message.error(errorInfo instanceof Error ? errorInfo.message : '批量导入失败');
    } finally {
      setImporting(false);
    }
  };

  const uploadProps: UploadProps = {
    accept: '.csv,text/csv',
    multiple: true,
    fileList: uploadFiles,
    onChange: ({ fileList }) => {
      setUploadFiles(fileList.slice(-100));
    },
    beforeUpload: async (file) => {
      const text = await file.text();
      setCsvText(text);
      return false;
    },
  };

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
        <Card
          size="small"
          title={<Typography.Text strong>芝麻租赁手动导入（CSV）</Typography.Text>}
          style={{ marginTop: 16 }}
          extra={
            <Space>
              <DatePicker value={importDate} onChange={(value) => value && setImportDate(value)} allowClear={false} />
              <Upload.Dragger {...uploadProps} style={{ width: 240, padding: 4 }}>
                <Space>
                  <InboxOutlined />
                  <Typography.Text>上传CSV(可多选)</Typography.Text>
                </Space>
              </Upload.Dragger>
            </Space>
          }
        >
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Text type="secondary">支持直接粘贴CSV，或批量上传CSV文件；批量上传时会优先从文件名识别日期（如 zulin_data_2026-03-18_2026-03-19T09-08-13.csv 取 2026-03-18）。</Typography.Text>
            <Input.TextArea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={10}
              placeholder="请粘贴CSV全文（含表头）"
            />
            <Space>
              <Button type="primary" loading={importing} onClick={importCsv}>
                解析并导入
              </Button>
              <Button type="primary" loading={importing} onClick={importCsvFiles}>
                批量导入已选文件
              </Button>
              <Button onClick={() => setCsvText('')}>清空</Button>
            </Space>
            {importResult ? (
              <Alert
                type="success"
                showIcon
                message="导入完成"
                description={`批次 ${importResult.batchId}，总计 ${importResult.payloadCount} 条，新增 ${importResult.insertedCount} 条，更新 ${importResult.updatedCount} 条，失败 ${importResult.failedCount} 条`}
              />
            ) : null}
            {batchImportResult ? (
              <Alert
                type="success"
                showIcon
                message="批量导入完成"
                description={`共处理 ${batchImportResult.fileCount} 个文件，总计 ${batchImportResult.payloadCount} 条，新增 ${batchImportResult.insertedCount} 条，更新 ${batchImportResult.updatedCount} 条，失败 ${batchImportResult.failedCount} 条`}
              />
            ) : null}
          </Space>
        </Card>
      </div>
    </MainLayout>
  );
};

export default ZulinAlertConfigPage;

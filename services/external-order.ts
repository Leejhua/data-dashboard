const API_URL = process.env.EXTERNAL_API_URL;
const API_TOKEN = process.env.EXTERNAL_API_TOKEN;

interface ExternalOrder {
  id: string;
  orderNo: string;
  source?: string;
  platform: string;
  status: string;
  productName?: string;
  variantName?: string;
  totalAmount: number | string | null;
  overdueFee?: number | string | null;
  recipientName?: string;
  recipientPhone?: string;
  address?: string;
  logisticsCompany?: string;
  trackingNumber?: string;
  latestLogisticsInfo?: string | null;
  returnLogisticsCompany?: string | null;
  returnTrackingNumber?: string | null;
  returnLatestLogisticsInfo?: string | null;
  creatorName?: string;
  customerXianyuId?: string;
  sourceContact?: string;
  sn?: string | null;
  duration?: number | string | null;
  rentPrice?: number | string | null;
  deposit?: number | string | null;
  insurancePrice?: number | string | null;
  rentStartDate?: string | null;
  returnDeadline?: string | null;
  deliveryTime?: string | null;
  actualDeliveryTime?: string | null;
  completedAt?: string | null;
  remark?: string | null;
  merchantName?: string;
  itemTitle?: string;
  itemSku?: string;
  promotionChannel?: string;
  customerName?: string;
  manualSn?: string | null;
  specId?: string | null;
  spec?: {
    specId?: string | null;
    name?: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface ExternalResponse {
  total: number;
  page: number;
  pageSize: number;
  data: ExternalOrder[];
}

type QueryValue = string | number | boolean | null | undefined;
type QueryParams = Record<string, QueryValue>;

export class ExternalOrderService {
  private static getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_TOKEN}`,
    };
  }

  private static toQueryString(params: QueryParams) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      searchParams.set(key, String(value));
    });
    return searchParams.toString();
  }

  static async fetchOrders(params: QueryParams): Promise<ExternalResponse> {
    const queryString = this.toQueryString(params);
    const response = await fetch(`${API_URL}/api/orders?${queryString}`, {
      headers: this.getHeaders(),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch orders: ${response.statusText}`);
    }
    
    return response.json();
  }

  static async fetchOnlineOrders(params: QueryParams): Promise<ExternalResponse> {
    const queryString = this.toQueryString(params);
    const response = await fetch(`${API_URL}/api/online-orders?${queryString}`, {
      headers: this.getHeaders(),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch online orders: ${response.statusText}`);
    }
    
    return response.json();
  }
}

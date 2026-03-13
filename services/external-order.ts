const API_URL = process.env.EXTERNAL_API_URL;
const API_TOKEN = process.env.EXTERNAL_API_TOKEN;

interface ExternalOrder {
  id: string;
  orderNo: string;
  source?: string;
  platform: string;
  status: string;
  productName: string;
  totalAmount: number;
  recipientName?: string;
  recipientPhone?: string;
  address?: string;
  logisticsCompany?: string;
  trackingNumber?: string;
  creatorName?: string; // For offline orders
  createdAt: string;
  updatedAt: string;
}

interface ExternalResponse {
  total: number;
  page: number;
  pageSize: number;
  data: ExternalOrder[];
}

export class ExternalOrderService {
  private static getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_TOKEN}`,
    };
  }

  static async fetchOrders(params: any): Promise<ExternalResponse> {
    const queryString = new URLSearchParams(params).toString();
    const response = await fetch(`${API_URL}/api/orders?${queryString}`, {
      headers: this.getHeaders(),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch orders: ${response.statusText}`);
    }
    
    return response.json();
  }

  static async fetchOnlineOrders(params: any): Promise<ExternalResponse> {
    const queryString = new URLSearchParams(params).toString();
    const response = await fetch(`${API_URL}/api/online-orders?${queryString}`, {
      headers: this.getHeaders(),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch online orders: ${response.statusText}`);
    }
    
    return response.json();
  }
}

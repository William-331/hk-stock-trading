import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

// 请求拦截器：自动加 token
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器：401 跳登录
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.hash = '#/login';
    }
    return Promise.reject(err);
  }
);

// Auth
export const login = (username: string, password: string) =>
  api.post('/auth/login', { username, password });

export const register = (username: string, password: string, real_name: string) =>
  api.post('/auth/register', { username, password, real_name });

export const changePassword = (oldPassword: string, newPassword: string) =>
  api.post('/auth/change-password', { oldPassword, newPassword });

// Stock / K-line
export const getKline = (limit = 1000) => api.get('/stocks/kline', { params: { limit } });
export const getLatestPrice = () => api.get('/stocks/latest');
export const addPrice = (data: any) => api.post('/stocks/add', data);
export const batchAddPrice = (prices: any[]) => api.post('/stocks/batch', { prices });

// Price Plan
export const getPricePlan = (params?: any) => api.get('/price-plan', { params });
export const setDailyPlan = (data: { date: string; open: number; close: number; volUp?: number; volDown?: number }) =>
  api.post('/price-plan/daily', data);
export const setBatchPlan = (data: { from: string; to: string; open: number; close: number }) =>
  api.post('/price-plan/batch', data);
export const updatePricePlan = (id: number, data: any) => api.put(`/price-plan/${id}`, data);
export const rebuildPriceRange = (data: {
  from: string;
  to: string;
  applyToStockPrices?: boolean;
  reason?: string;
  days: Array<{ date: string; open: number; close: number; volUp?: number; volDown?: number; skip?: boolean }>;
}) => api.post('/price-plan/rebuild-range', data);

// Orders
export const submitOrder = (data: { type: string; quantity: number; price: number }) =>
  api.post('/orders', data);
export const getMyOrders = (page = 1) => api.get('/orders/my', { params: { page } });
export const getOrderDetail = (id: number) => api.get(`/orders/${id}`);

// Audit
export const getPendingOrders = () => api.get('/audit/pending');
export const approveOrder = (id: number, comment?: string) =>
  api.post(`/audit/${id}/approve`, { comment });
export const rejectOrder = (id: number, comment: string) =>
  api.post(`/audit/${id}/reject`, { comment });

// Account
export const getAccount = () => api.get('/account');
export const getPosition = () => api.get('/account/position');
export const getMyTrades = () => api.get('/account/trades');
export const getFunds = () => api.get('/account/funds');

// Admin
export const getDashboard = () => api.get('/admin/dashboard');
export const getUsers = (params?: any) => api.get('/admin/users', { params });
export const updateUser = (id: number, data: any) => api.put(`/admin/users/${id}`, data);
export const addUser = (data: any) => api.post('/admin/users', data);
export const batchGenerateUsers = (data: { count: number; balance?: number; prefix?: string; pwdLen?: number }) =>
  api.post('/admin/users/batch-generate', data);
export const deleteUser = (id: number) => api.delete(`/admin/users/${id}`);
export const getTradeRecords = (params: any) => api.get('/admin/trades', { params });
export const getLogs = (page = 1) => api.get('/admin/logs', { params: { page } });

// Stock Info
export const getStockInfo = () => api.get('/stock-info');

// Export / Backup
export const exportTrades = (params?: any) =>
  api.get('/export/trades', { params, responseType: 'blob' });
export const exportAudit = () => api.get('/export/audit', { responseType: 'blob' });
export const exportUsers = (params?: any) =>
  api.get('/export/users', { params, responseType: 'blob' });
export const exportTradesWord = (params?: any) =>
  api.get('/export/trades-word', { params, responseType: 'blob' });
export const exportAuditWord = () =>
  api.get('/export/audit-word', { responseType: 'blob' });
export const backupTrades = () => api.post('/export/backup');
export const dailySummary = (date?: string) =>
  api.post('/export/daily-summary', { date }, { responseType: 'blob' });
export const getBackupList = () => api.get('/export/backup/list');
export const downloadBackup = (id: number) =>
  api.get(`/export/backup/download/${id}`, { responseType: 'blob' });

// Settings
export const getSettings = () => api.get('/admin/settings');
export const updateSettings = (data: any) => api.put('/admin/settings', data);

// HK Market
export const getHKList = () => api.get('/market/hklist');

// HK Detail
export const getHKQuote = (code: string) => api.get(`/hk/quote/${code}`);
export const getHKKline = (code: string, period: 'day' | 'week' | 'month' = 'day') =>
  api.get(`/hk/kline/${code}`, { params: { period } });
export const getHKIntraday = (code: string) => api.get(`/hk/intraday/${code}`);
export const getHKNews = () => api.get('/hk/news');

export default api;

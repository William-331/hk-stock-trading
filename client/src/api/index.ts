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

// Stock / K-line
export const getKline = () => api.get('/stocks/kline');
export const getLatestPrice = () => api.get('/stocks/latest');
export const addPrice = (data: any) => api.post('/stocks/add', data);
export const batchAddPrice = (prices: any[]) => api.post('/stocks/batch', { prices });

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
export const getUsers = () => api.get('/admin/users');
export const updateUser = (id: number, data: any) => api.put(`/admin/users/${id}`, data);
export const getTradeRecords = (params: any) => api.get('/admin/trades', { params });
export const getLogs = (page = 1) => api.get('/admin/logs', { params: { page } });

// Stock Info
export const getStockInfo = () => api.get('/stock-info');

// Export / Backup
export const exportTrades = (params?: any) =>
  api.get('/export/trades', { params, responseType: 'blob' });
export const exportAudit = () => api.get('/export/audit', { responseType: 'blob' });
export const exportTradesWord = (params?: any) =>
  api.get('/export/trades-word', { params, responseType: 'blob' });
export const exportAuditWord = () =>
  api.get('/export/audit-word', { responseType: 'blob' });
export const backupTrades = () => api.post('/export/backup');
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

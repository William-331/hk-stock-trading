import express from 'express';
import path from 'path';
import cors from 'cors';
import cron, { ScheduledTask } from 'node-cron';
import { initDB, seedData, logOperation } from './db';
import db from './db';

import authRoutes from './routes/auth';
import stocksRoutes from './routes/stocks';
import ordersRoutes from './routes/orders';
import auditRoutes from './routes/audit';
import accountRoutes from './routes/account';
import exportRoutes, { autoBackup } from './routes/export';
import marketRoutes from './routes/market';
import hkDetailRoutes from './routes/hkdetail';
import { requireAuth, requireAdmin } from './middleware/auth';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// 初始化数据库
initDB();
seedData();

// 路由注册
app.use('/api/auth', authRoutes);
app.use('/api/stocks', stocksRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/hk', hkDetailRoutes);


// 获取当前用户信息
app.get('/api/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// 获取标的信息（名称、代码）
app.get('/api/stock-info', (_req, res) => {
  const items = db.prepare("SELECT key, value FROM settings WHERE key IN ('stock_code','stock_name')").all() as any[];
  const info: any = { code: '02110.HK', name: '天诚控股' };
  items.forEach((item: any) => {
    if (item.key === 'stock_code') info.code = item.value;
    if (item.key === 'stock_name') info.name = item.value;
  });
  res.json(info);
});

// ==================== 后台管理 ====================

// 仪表盘统计
app.get('/api/admin/dashboard', requireAuth, requireAdmin, (_req, res) => {
  const userCount = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as any).cnt;
  const pendingCount = (db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status = 'pending'").get() as any).cnt;
  const tradeCount = (db.prepare('SELECT COUNT(*) as cnt FROM trade_records').get() as any).cnt;
  const totalAmount = (db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM trade_records').get() as any).total;
  res.json({ userCount, pendingCount, tradeCount, totalAmount });
});

// 用户管理
app.get('/api/admin/users', requireAuth, requireAdmin, (_req, res) => {
  const users = db.prepare('SELECT id, username, real_name, role, balance, status, created_at FROM users ORDER BY id').all();
  res.json(users);
});

app.put('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const { role, status, balance } = req.body;
  const userId = req.params.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  if (status !== undefined) db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, userId);
  if (balance !== undefined) db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(balance, userId);
  logOperation(req.user!.id, req.user!.username, 'update_user', `修改用户#${userId}: ${JSON.stringify(req.body)}`);
  res.json({ message: '更新成功' });
});

// 交易记录查询
app.get('/api/admin/trades', requireAuth, requireAdmin, (req, res) => {
  const { username, startDate, endDate, page = '1', pageSize = '50' } = req.query;
  let query = `SELECT tr.*, u.username, u.real_name FROM trade_records tr JOIN users u ON u.id = tr.user_id WHERE 1=1`;
  const params: any[] = [];
  if (username) { query += ' AND u.username LIKE ?'; params.push(`%${username}%`); }
  if (startDate) { query += ' AND tr.created_at >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND tr.created_at <= ?'; params.push(endDate + ' 23:59:59'); }
  const total = (db.prepare(query.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as cnt FROM')).get(...params) as any).cnt;
  query += ' ORDER BY tr.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));
  const rows = db.prepare(query).all(...params);
  res.json({ total, list: rows, page: Number(page), pageSize: Number(pageSize) });
});

// 操作日志
app.get('/api/admin/logs', requireAuth, requireAdmin, (req, res) => {
  const { page = '1', pageSize = '50' } = req.query;
  const total = (db.prepare('SELECT COUNT(*) as cnt FROM operation_logs').get() as any).cnt;
  const rows = db.prepare('SELECT * FROM operation_logs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(Number(pageSize), (Number(page) - 1) * Number(pageSize));
  res.json({ total, list: rows, page: Number(page), pageSize: Number(pageSize) });
});

// 设置管理（标的名称 + 备份时间）
app.get('/api/admin/settings', requireAuth, requireAdmin, (_req, res) => {
  const items = db.prepare("SELECT key, value, updated_at FROM settings").all();
  res.json(items);
});

app.put('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
  const { stock_code, stock_name, backup_time } = req.body;
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)');
  if (stock_code !== undefined) upsert.run('stock_code', stock_code, req.user!.id);
  if (stock_name !== undefined) upsert.run('stock_name', stock_name, req.user!.id);
  if (backup_time !== undefined) { upsert.run('backup_time', backup_time, req.user!.id); setupCron(); }
  logOperation(req.user!.id, req.user!.username, 'update_settings', JSON.stringify(req.body));
  res.json({ message: '设置已更新' });
});

// ==================== 定时自动备份 ====================

let cronTask: ScheduledTask | null = null;

function setupCron() {
  if (cronTask) cronTask.stop();
  const backupTime = (db.prepare("SELECT value FROM settings WHERE key = 'backup_time'").get() as any)?.value || '23:00';
  const [hour, minute] = backupTime.split(':').map(Number);

  cronTask = cron.schedule(`${minute} ${hour} * * *`, () => {
    console.log(`[cron] 开始每日自动备份 (${backupTime})`);
    autoBackup().catch(err => console.error('[cron] 备份失败:', err));
  }, { timezone: 'Asia/Shanghai' });

  console.log(`⏰ 每日自动备份: ${backupTime} (北京时间)`);
}

// ==================== 生产环境静态资源 ====================
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (require('fs').existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  console.log(`📦 已启用前端静态资源: ${clientDist}`);
}

// ==================== 启动 ====================

app.listen(PORT, () => {
  console.log(`🚀 服务已启动: http://localhost:${PORT}`);
  console.log(`   标的: ${(db.prepare("SELECT value FROM settings WHERE key='stock_code'").get() as any)?.value || '02110'}`);
  console.log(`   默认账户: user1/123456, admin/123456`);
  setupCron();
});

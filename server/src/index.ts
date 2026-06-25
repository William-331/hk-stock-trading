import 'dotenv/config';
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
import pricePlanRoutes, { triggerPricePlan } from './routes/pricePlan';
import { requireAuth, requireAdmin } from './middleware/auth';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

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
app.use('/api/price-plan', pricePlanRoutes);


// 获取当前用户信息
app.get('/api/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// 获取标的信息（名称、代码）
app.get('/api/stock-info', (_req, res) => {
  const items = db.prepare("SELECT key, value FROM settings WHERE key IN ('stock_code','stock_name')").all() as any[];
  const info: any = { code: '02110.HK', name: '天成控股' };
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
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const { search } = req.query;
  let query = `
    SELECT u.id, u.username, u.password_plain, u.real_name, u.role, u.balance, u.status, u.created_at,
           COALESCE(p.quantity, 0) as position_qty, COALESCE(p.avg_cost, 0) as avg_cost
    FROM users u
    LEFT JOIN positions p ON p.user_id = u.id
  `;
  const params: any[] = [];
  if (search) {
    query += ' WHERE u.username LIKE ? OR u.real_name LIKE ?';
    params.push(`%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY u.id';
  const users = db.prepare(query).all(...params);
  res.json(users);
});

app.put('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const { role, status, balance, password } = req.body;
  const userId = req.params.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  if (status !== undefined) db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, userId);
  if (balance !== undefined) db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(balance, userId);
  if (password) {
    const hash = require('bcryptjs').hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ?, password_plain = ? WHERE id = ?').run(hash, password, userId);
  }
  logOperation(req.user!.id, req.user!.username, 'update_user', `修改用户#${userId}: ${JSON.stringify(req.body)}`);
  res.json({ message: '更新成功' });
});

app.post('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const { username, real_name, password, balance, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  try {
    const hash = require('bcryptjs').hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password_hash, password_plain, real_name, role, balance) VALUES (?, ?, ?, ?, ?, ?)').run(
      username, hash, password, real_name || '', role || 'user', balance || 1000000
    );
    logOperation(req.user!.id, req.user!.username, 'add_user', `新增用户: ${username}`);
    res.json({ message: '用户已创建' });
  } catch (e: any) {
    res.status(400).json({ error: e.message.includes('UNIQUE') ? '用户名已存在' : e.message });
  }
});

// 批量随机生成用户
app.post('/api/admin/users/batch-generate', requireAuth, requireAdmin, (req, res) => {
  const count = Math.min(Math.max(Number(req.body.count) || 0, 1), 500);
  const balance = req.body.balance !== undefined ? Number(req.body.balance) : 1000000;
  const prefix = (req.body.prefix || 'user').toString().replace(/[^a-zA-Z0-9_]/g, '') || 'user';
  const pwdLen = Math.min(Math.max(Number(req.body.pwdLen) || 6, 4), 16);

  // 找出当前 prefix 下最大的编号，接着往后排
  const like = `${prefix}%`;
  const existing = db.prepare('SELECT username FROM users WHERE username LIKE ?').all(like) as any[];
  let maxNum = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const u of existing) {
    const m = u.username.match(re);
    if (m) maxNum = Math.max(maxNum, Number(m[1]));
  }

  const genPwd = (len: number) => {
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789'; // 去掉易混字符 l/o/0/1
    let s = '';
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  };

  const created: { username: string; password: string }[] = [];
  const insert = db.prepare(
    'INSERT INTO users (username, password_hash, password_plain, real_name, role, balance) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertPos = db.prepare('INSERT OR IGNORE INTO positions (user_id, quantity, avg_cost) VALUES (?, 0, 0)');

  const tx = db.transaction(() => {
    for (let i = 1; i <= count; i++) {
      const num = maxNum + i;
      const username = `${prefix}${String(num).padStart(3, '0')}`;
      const password = genPwd(pwdLen);
      const hash = require('bcryptjs').hashSync(password, 10);
      const result = insert.run(username, hash, password, '', 'user', balance);
      insertPos.run(result.lastInsertRowid);
      created.push({ username, password });
    }
  });
  tx();

  logOperation(req.user!.id, req.user!.username, 'batch_generate_users', `批量生成 ${created.length} 个用户`);
  res.json({ message: `已生成 ${created.length} 个用户`, users: created });
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const userId = req.params.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.role === 'admin') {
    const adminCount = (db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'").get() as any).cnt;
    if (adminCount <= 1) return res.status(400).json({ error: '不能删除最后一个管理员' });
  }
  try {
    db.prepare('DELETE FROM audit_records WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)').run(userId);
    db.prepare('DELETE FROM trade_records WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM orders WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM positions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM price_plan WHERE created_by = ?').run(userId);
    db.prepare('UPDATE operation_logs SET user_id = NULL WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    logOperation(req.user!.id, req.user!.username, 'delete_user', `删除用户: ${user.username}`);
    res.json({ message: '已删除' });
  } catch (e: any) {
    res.status(500).json({ error: '删除失败: ' + e.message });
  }
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
let priceCronTask: ScheduledTask | null = null;

function setupCron() {
  if (cronTask) cronTask.stop();
  if (priceCronTask) priceCronTask.stop();

  const backupTime = (db.prepare("SELECT value FROM settings WHERE key = 'backup_time'").get() as any)?.value || '23:00';
  const [hour, minute] = backupTime.split(':').map(Number);

  cronTask = cron.schedule(`${minute} ${hour} * * *`, () => {
    console.log(`[cron] 开始每日自动备份 (${backupTime})`);
    autoBackup().catch(err => console.error('[cron] 备份失败:', err));
  }, { timezone: 'Asia/Shanghai' });

  // 每分钟触发价格计划
  priceCronTask = cron.schedule('* * * * *', () => {
    const count = triggerPricePlan();
    if (count > 0) console.log(`[cron] 触发 ${count} 个价格计划`);
  }, { timezone: 'Asia/Shanghai' });

  console.log(`⏰ 每日自动备份: ${backupTime} (北京时间)`);
  console.log(`📊 价格计划每分钟自动触发已就绪`);
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

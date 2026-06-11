import { Router, Request, Response } from 'express';
import db, { logOperation } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

// 提交买卖申请
router.post('/', requireAuth, (req: Request, res: Response) => {
  const { type, quantity, price } = req.body;
  const userId = req.user!.id;

  if (!type || !['buy', 'sell'].includes(type)) {
    return res.status(400).json({ error: '类型必须是 buy 或 sell' });
  }
  if (!quantity || quantity <= 0 || !Number.isInteger(quantity)) {
    return res.status(400).json({ error: '数量必须是正整数' });
  }
  if (!price || price <= 0) {
    return res.status(400).json({ error: '价格必须大于0' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
  if (!user || user.status !== 'active') {
    return res.status(403).json({ error: '账户不可用' });
  }

  // 卖出时检查持仓
  if (type === 'sell') {
    const pos = db.prepare('SELECT * FROM positions WHERE user_id = ?').get(userId) as any;
    if (!pos || pos.quantity < quantity) {
      return res.status(400).json({ error: `持仓不足，当前持仓 ${pos?.quantity || 0} 股` });
    }
  }

  // 买入时检查余额
  if (type === 'buy') {
    const totalAmount = quantity * price;
    if (user.balance < totalAmount) {
      return res.status(400).json({
        error: `余额不足，需要 ¥${totalAmount.toFixed(2)}，当前余额 ¥${user.balance.toFixed(2)}`,
      });
    }
  }

  const result = db.prepare(
    'INSERT INTO orders (user_id, type, quantity, price) VALUES (?, ?, ?, ?)'
  ).run(userId, type, quantity, price);

  logOperation(userId, req.user!.username, 'submit_order', `${type} ${quantity}股 @${price}`);

  res.json({ id: result.lastInsertRowid, message: '申请已提交，等待审核' });
});

// 我的申请列表
router.get('/my', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { page = '1', pageSize = '20' } = req.query;

  const total = (db.prepare(
    'SELECT COUNT(*) as cnt FROM orders WHERE user_id = ?'
  ).get(userId) as any).cnt;

  const rows = db.prepare(`
    SELECT o.*, ar.comment as audit_comment, ar.action as audit_action, ar.created_at as audit_time
    FROM orders o
    LEFT JOIN audit_records ar ON ar.order_id = o.id
    WHERE o.user_id = ?
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, Number(pageSize), (Number(page) - 1) * Number(pageSize));

  res.json({ total, list: rows, page: Number(page), pageSize: Number(pageSize) });
});

// 申请详情
router.get('/:id', requireAuth, (req: Request, res: Response) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
  if (!order) return res.status(404).json({ error: '申请不存在' });

  const audit = db.prepare(
    'SELECT ar.*, u.real_name as auditor_name FROM audit_records ar LEFT JOIN users u ON u.id = ar.auditor_id WHERE ar.order_id = ?'
  ).all(order.id);

  res.json({ order, audits: audit });
});

export default router;

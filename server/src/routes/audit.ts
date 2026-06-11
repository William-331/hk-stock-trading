import { Router, Request, Response } from 'express';
import db, { logOperation } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

// 待审列表
router.get('/pending', requireAuth, (req: Request, res: Response) => {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ error: '需要审核权限' });
  }

  const rows = db.prepare(`
    SELECT o.*, u.username, u.real_name
    FROM orders o
    JOIN users u ON u.id = o.user_id
    WHERE o.status = 'pending'
    ORDER BY o.created_at ASC
  `).all();

  res.json(rows);
});

// 通过申请
router.post('/:id/approve', requireAuth, (req: Request, res: Response) => {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ error: '需要审核权限' });
  }

  const orderId = Number(req.params.id);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
  if (!order) return res.status(404).json({ error: '申请不存在' });
  if (order.status !== 'pending') return res.status(400).json({ error: '申请状态不是待审核' });

  // 不能审自己的
  if (order.user_id === req.user!.id) {
    return res.status(400).json({ error: '不能审核自己的申请' });
  }

  const tx = db.transaction(() => {
    // 更新订单状态
    db.prepare("UPDATE orders SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(orderId);

    // 写审核记录
    db.prepare(
      'INSERT INTO audit_records (order_id, auditor_id, action, comment) VALUES (?, ?, ?, ?)'
    ).run(orderId, req.user!.id, 'approve', req.body.comment || '通过');

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id) as any;
    const amount = order.quantity * order.price;

    if (order.type === 'buy') {
      // 扣余额
      const newBalance = user.balance - amount;
      db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, order.user_id);

      // 更新持仓
      const pos = db.prepare('SELECT * FROM positions WHERE user_id = ?').get(order.user_id) as any;
      if (pos && pos.quantity > 0) {
        const totalCost = pos.avg_cost * pos.quantity + amount;
        const newQty = pos.quantity + order.quantity;
        const newAvgCost = totalCost / newQty;
        db.prepare('UPDATE positions SET quantity = ?, avg_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
          .run(newQty, Math.round(newAvgCost * 100) / 100, order.user_id);
      } else {
        db.prepare('INSERT OR REPLACE INTO positions (user_id, quantity, avg_cost, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
          .run(order.user_id, order.quantity, order.price);
      }
    } else {
      // 卖出：加余额
      const newBalance = user.balance + amount;
      db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, order.user_id);

      // 减持仓
      const pos = db.prepare('SELECT * FROM positions WHERE user_id = ?').get(order.user_id) as any;
      const newQty = pos.quantity - order.quantity;
      db.prepare('UPDATE positions SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
        .run(newQty, order.user_id);
    }

    // 生成成交记录
    db.prepare(
      'INSERT INTO trade_records (user_id, order_id, type, quantity, price, amount) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(order.user_id, orderId, order.type, order.quantity, order.price, amount);
  });

  tx();

  logOperation(req.user!.id, req.user!.username, 'approve_order',
    `审批通过 #${orderId}: user=${order.user_id} ${order.type} ${order.quantity}股 @${order.price}`);

  res.json({ message: '已通过，成交记录已生成' });
});

// 驳回申请
router.post('/:id/reject', requireAuth, (req: Request, res: Response) => {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ error: '需要审核权限' });
  }

  const orderId = Number(req.params.id);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
  if (!order) return res.status(404).json({ error: '申请不存在' });

  const { comment } = req.body;
  if (!comment || !comment.trim()) {
    return res.status(400).json({ error: '驳回必须填写原因' });
  }

  db.prepare("UPDATE orders SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(orderId);
  db.prepare(
    'INSERT INTO audit_records (order_id, auditor_id, action, comment) VALUES (?, ?, ?, ?)'
  ).run(orderId, req.user!.id, 'reject', comment);

  logOperation(req.user!.id, req.user!.username, 'reject_order',
    `驳回 #${orderId}: ${comment}`);

  res.json({ message: '已驳回' });
});

// 审核历史
router.get('/history', requireAuth, (req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT ar.*, o.type as order_type, o.quantity, o.price,
           u1.username as auditor_name, u2.username as applicant_name
    FROM audit_records ar
    JOIN orders o ON o.id = ar.order_id
    LEFT JOIN users u1 ON u1.id = ar.auditor_id
    LEFT JOIN users u2 ON u2.id = o.user_id
    ORDER BY ar.created_at DESC
    LIMIT 100
  `).all();

  res.json(rows);
});

export default router;

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
  if (req.user!.role !== 'admin') return res.status(403).json({ error: '需要审核权限' });

  const orderId = Number(req.params.id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return res.status(400).json({ error: '申请ID无效' });

  try {
    const approved = db.transaction(() => {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
      if (!order) throw new Error('ORDER_NOT_FOUND');
      if (order.status !== 'pending') throw new Error('ORDER_NOT_PENDING');
      if (order.user_id === req.user!.id) throw new Error('SELF_APPROVAL');

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id) as any;
      if (!user || user.status !== 'active') throw new Error('ACCOUNT_UNAVAILABLE');
      const amount = Number(order.quantity) * Number(order.price);
      const pos = db.prepare('SELECT * FROM positions WHERE user_id = ?').get(order.user_id) as any;

      if (order.type === 'buy' && Number(user.balance) + 1e-9 < amount) throw new Error('BALANCE_SHORT');
      if (order.type === 'sell' && Number(pos?.quantity || 0) < Number(order.quantity)) throw new Error('POSITION_SHORT');

      const stateUpdate = db.prepare(
        "UPDATE orders SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'"
      ).run(orderId);
      if (stateUpdate.changes !== 1) throw new Error('ORDER_NOT_PENDING');

      db.prepare('INSERT INTO audit_records (order_id, auditor_id, action, comment) VALUES (?, ?, ?, ?)')
        .run(orderId, req.user!.id, 'approve', req.body.comment || '通过');

      if (order.type === 'buy') {
        db.prepare('UPDATE users SET balance = ?, revision = revision + 1 WHERE id = ?')
          .run(Math.round((Number(user.balance) - amount) * 100) / 100, order.user_id);
        if (pos && pos.quantity > 0) {
          const newQty = Number(pos.quantity) + Number(order.quantity);
          const newAvgCost = (Number(pos.avg_cost) * Number(pos.quantity) + amount) / newQty;
          db.prepare('UPDATE positions SET quantity = ?, avg_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
            .run(newQty, Math.round(newAvgCost * 100) / 100, order.user_id);
        } else {
          db.prepare(`
            INSERT INTO positions (user_id, quantity, avg_cost, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET quantity = excluded.quantity, avg_cost = excluded.avg_cost, updated_at = CURRENT_TIMESTAMP
          `).run(order.user_id, order.quantity, order.price);
        }
      } else {
        const newQty = Number(pos.quantity) - Number(order.quantity);
        db.prepare('UPDATE users SET balance = ?, revision = revision + 1 WHERE id = ?')
          .run(Math.round((Number(user.balance) + amount) * 100) / 100, order.user_id);
        db.prepare('UPDATE positions SET quantity = ?, avg_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
          .run(newQty, newQty === 0 ? 0 : pos.avg_cost, order.user_id);
      }

      db.prepare('INSERT INTO trade_records (user_id, order_id, type, quantity, price, amount) VALUES (?, ?, ?, ?, ?, ?)')
        .run(order.user_id, orderId, order.type, order.quantity, order.price, amount);
      return order;
    })();

    const typeLabel = approved.type === 'buy' ? '认购' : '申请转让';
    logOperation(req.user!.id, req.user!.username, 'approve_order',
      `审批通过 #${orderId}: 用户=${approved.user_id} ${typeLabel} ${approved.quantity}股，参考估值 ${approved.price}`);
    res.json({ message: '已通过，认购与转让记录已生成' });
  } catch (error: any) {
    const messages: Record<string, [number, string]> = {
      ORDER_NOT_FOUND: [404, '申请不存在'],
      ORDER_NOT_PENDING: [409, '申请已被处理，请刷新列表'],
      SELF_APPROVAL: [400, '不能审核自己的申请'],
      ACCOUNT_UNAVAILABLE: [409, '用户账户当前不可用'],
      BALANCE_SHORT: [409, '用户当前余额不足，无法通过该认购意向'],
      POSITION_SHORT: [409, '用户当前权证持有量不足，无法通过该转让意向'],
    };
    const mapped = messages[error.message];
    if (mapped) return res.status(mapped[0]).json({ error: mapped[1], code: error.message });
    res.status(500).json({ error: '审核失败' });
  }
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

  try {
    db.transaction(() => {
      const current = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId) as any;
      if (!current || current.status !== 'pending') throw new Error('ORDER_NOT_PENDING');
      const updated = db.prepare("UPDATE orders SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(orderId);
      if (updated.changes !== 1) throw new Error('ORDER_NOT_PENDING');
      db.prepare('INSERT INTO audit_records (order_id, auditor_id, action, comment) VALUES (?, ?, ?, ?)')
        .run(orderId, req.user!.id, 'reject', comment);
    })();
  } catch (error: any) {
    if (error.message === 'ORDER_NOT_PENDING') return res.status(409).json({ error: '申请已被处理，请刷新列表' });
    return res.status(500).json({ error: '驳回失败' });
  }

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

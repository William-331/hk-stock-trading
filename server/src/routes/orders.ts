import { Router, Request, Response } from 'express';
import db, { logOperation } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

// 提交认购或申请转让
router.post('/', requireAuth, (req: Request, res: Response) => {
  const { type, quantity, price } = req.body;
  const userId = req.user!.id;

  if (!type || !['buy', 'sell'].includes(type)) {
    return res.status(400).json({ error: '类型必须是认购或申请转让' });
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: '数量必须是正整数' });
  }
  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: '参考估值必须大于0' });
  }

  try {
    const result = db.transaction(() => {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
      if (!user || user.status !== 'active') throw new Error('ACCOUNT_UNAVAILABLE');

      const reserved = db.prepare(`
        SELECT COALESCE(SUM(CASE WHEN type = 'buy' THEN quantity * price ELSE 0 END), 0) AS buy_amount,
               COALESCE(SUM(CASE WHEN type = 'sell' THEN quantity ELSE 0 END), 0) AS sell_quantity
        FROM orders WHERE user_id = ? AND status = 'pending'
      `).get(userId) as any;

      if (type === 'sell') {
        const pos = db.prepare('SELECT quantity FROM positions WHERE user_id = ?').get(userId) as any;
        const availableQuantity = Number(pos?.quantity || 0) - Number(reserved.sell_quantity || 0);
        if (availableQuantity < quantity) throw new Error(`POSITION_SHORT:${availableQuantity}`);
      } else {
        const totalAmount = quantity * price;
        const availableBalance = Number(user.balance) - Number(reserved.buy_amount || 0);
        if (availableBalance + 1e-9 < totalAmount) throw new Error(`BALANCE_SHORT:${availableBalance}:${totalAmount}`);
      }

      return db.prepare('INSERT INTO orders (user_id, type, quantity, price) VALUES (?, ?, ?, ?)')
        .run(userId, type, quantity, price);
    })();

    const typeLabel = type === 'buy' ? '认购' : '申请转让';
    logOperation(userId, req.user!.username, 'submit_order', `${typeLabel} ${quantity}股，参考估值 ${price}`);
    res.json({ id: result.lastInsertRowid, message: '申请已提交，等待审核' });
  } catch (error: any) {
    if (error.message === 'ACCOUNT_UNAVAILABLE') return res.status(403).json({ error: '账户不可用' });
    if (error.message.startsWith('POSITION_SHORT:')) {
      const available = Number(error.message.split(':')[1]);
      return res.status(400).json({ error: `可申请转让的权证持有量不足，扣除待审意向后可用 ${available} 股` });
    }
    if (error.message.startsWith('BALANCE_SHORT:')) {
      const [, availableText, neededText] = error.message.split(':');
      return res.status(400).json({ error: `可用余额不足，需要 ¥${Number(neededText).toFixed(2)}，扣除待审意向后可用 ¥${Number(availableText).toFixed(2)}` });
    }
    return res.status(500).json({ error: '申请提交失败' });
  }
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

// 撤单：撤销自己「待审核」状态的申请
// 待审核订单尚未产生任何副作用(未扣款/未加仓/未写成交)，故直接删除即可，
// 并写一条操作日志留痕。已通过/已驳回的订单不可撤销。
router.post('/:id/cancel', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;

  if (!order) return res.status(404).json({ error: '申请不存在' });
  if (order.user_id !== userId) {
    return res.status(403).json({ error: '无权撤销该申请' });
  }
  if (order.status !== 'pending') {
    return res.status(400).json({ error: '仅可撤销待审核的申请' });
  }

  db.prepare('DELETE FROM orders WHERE id = ?').run(order.id);
  const typeLabel = order.type === 'buy' ? '认购' : '申请转让';
  logOperation(userId, req.user!.username, 'cancel_order', `${typeLabel} ${order.quantity}股，参考估值 ${order.price}`);

  res.json({ message: '申请已撤销' });
});

// 申请详情
router.get('/:id', requireAuth, (req: Request, res: Response) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
  if (!order) return res.status(404).json({ error: '申请不存在' });

  // 只能查看自己的申请（管理员可查看全部）
  if (order.user_id !== req.user!.id && req.user!.role !== 'admin') {
    return res.status(403).json({ error: '无权查看该申请' });
  }

  const audit = db.prepare(
    'SELECT ar.*, u.real_name as auditor_name FROM audit_records ar LEFT JOIN users u ON u.id = ar.auditor_id WHERE ar.order_id = ?'
  ).all(order.id);

  res.json({ order, audits: audit });
});

export default router;

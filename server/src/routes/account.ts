import { Router, Request, Response } from 'express';
import db from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

// 我的账户信息
router.get('/', requireAuth, (req: Request, res: Response) => {
  const user = db.prepare('SELECT id, username, real_name, role, balance, status FROM users WHERE id = ?').get(req.user!.id) as any;
  res.json(user);
});

// 我的持仓
router.get('/position', requireAuth, (req: Request, res: Response) => {
  const pos = db.prepare('SELECT * FROM positions WHERE user_id = ?').get(req.user!.id) as any;
  if (!pos) return res.json({ quantity: 0, avg_cost: 0 });

  const latest = db.prepare('SELECT close FROM stock_prices ORDER BY id DESC LIMIT 1').get() as any;
  const currentPrice = latest?.close || 0;
  const marketValue = pos.quantity * currentPrice;
  const profit = marketValue - pos.quantity * pos.avg_cost;
  const profitPct = pos.avg_cost > 0 ? ((profit / (pos.quantity * pos.avg_cost)) * 100) : 0;

  res.json({
    quantity: pos.quantity,
    avg_cost: pos.avg_cost,
    current_price: currentPrice,
    market_value: Math.round(marketValue * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    profit_pct: Math.round(profitPct * 100) / 100,
    updated_at: pos.updated_at,
  });
});

// 我的成交记录
router.get('/trades', requireAuth, (req: Request, res: Response) => {
  const rows = db.prepare(
    'SELECT * FROM trade_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).all(req.user!.id);
  res.json(rows);
});

// 资金流水
router.get('/funds', requireAuth, (req: Request, res: Response) => {
  const rows = db.prepare(
    'SELECT * FROM trade_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).all(req.user!.id);

  res.json(rows.map((r: any) => ({
    id: r.id,
    type: r.type,
    amount: r.type === 'buy' ? -r.amount : r.amount,
    quantity: r.quantity,
    price: r.price,
    time: r.created_at,
  })));
});

export default router;

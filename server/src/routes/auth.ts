import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db';
import { JWT_SECRET, requireAuth } from '../middleware/auth';

const router = Router();

// 登录
router.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  if (user.status !== 'active') {
    return res.status(403).json({ error: '账户已被冻结' });
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, real_name: user.real_name, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  db.prepare(
    'INSERT INTO operation_logs (user_id, username, action, detail) VALUES (?, ?, ?, ?)'
  ).run(user.id, user.username, 'login', '用户登录');

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      real_name: user.real_name,
      role: user.role,
      balance: user.balance,
    },
  });
});

// 注册
router.post('/register', (req: Request, res: Response) => {
  const { username, password, real_name } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码必填' });
  }

  const exist = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exist) {
    return res.status(400).json({ error: '用户名已存在' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (username, password_hash, real_name) VALUES (?, ?, ?)'
  ).run(username, hash, real_name || username);

  // 自动创建持仓记录
  db.prepare('INSERT INTO positions (user_id, quantity, avg_cost) VALUES (?, 0, 0)').run(result.lastInsertRowid);

  res.json({ message: '注册成功' });
});

// 修改密码（登录用户本人）
router.post('/change-password', requireAuth, (req: Request, res: Response) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: '请输入原密码和新密码' });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: '新密码至少6位' });
  }
  if (oldPassword === newPassword) {
    return res.status(400).json({ error: '新密码不能与原密码相同' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }
  if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
    return res.status(400).json({ error: '原密码错误' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);

  db.prepare(
    'INSERT INTO operation_logs (user_id, username, action, detail) VALUES (?, ?, ?, ?)'
  ).run(user.id, user.username, 'change_password', '用户修改密码');

  res.json({ message: '密码修改成功' });
});

export default router;

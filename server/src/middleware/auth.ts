import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// 优先读环境变量 JWT_SECRET。未设置时不再回退到硬编码密钥(硬编码密钥人人可知,
// 会被用来伪造管理员 token),而是启动时随机生成一个。
// 代价:服务重启后旧 token 全部失效(用户需重新登录),对本项目可接受。
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  未设置 JWT_SECRET 环境变量,已随机生成本次运行的密钥(重启后需重新登录)。生产环境建议通过环境变量固定注入。');
}

export interface AuthUser {
  id: number;
  username: string;
  real_name: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// JWT 必需
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: '请先登录' });
  }
  try {
    const user = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

// 可选 JWT（不登录也能看行情）
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET) as AuthUser;
    } catch { /* 忽略 */ }
  }
  next();
}

// 需要管理员角色
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

export { JWT_SECRET };

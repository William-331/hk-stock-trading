import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'stock-trading-2024-secret-key';

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

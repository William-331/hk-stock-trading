import Database from 'better-sqlite3';
import path from 'path';
import bcrypt from 'bcryptjs';

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'trading.db');

const db = new Database(DB_PATH);

// 开启 WAL 模式提升性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      real_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user',
      balance REAL NOT NULL DEFAULT 1000000,
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume INTEGER NOT NULL DEFAULT 0,
      time_slot TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(time_slot)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK(type IN ('buy','sell')),
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      auditor_id INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL CHECK(action IN ('approve','reject')),
      comment TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      quantity INTEGER NOT NULL DEFAULT 0,
      avg_cost REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id)
    );

    CREATE TABLE IF NOT EXISTS trade_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      order_id INTEGER NOT NULL REFERENCES orders(id),
      type TEXT NOT NULL CHECK(type IN ('buy','sell')),
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      amount REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      username TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      type TEXT NOT NULL,
      record_count INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_by INTEGER REFERENCES users(id),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 初始化默认设置
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('stock_code', '02110');
  insertSetting.run('stock_name', '02110');
  insertSetting.run('backup_time', '23:00');
  insertSetting.run('backup_enabled', 'true');

  // 如果已有旧数据"模拟标的"，更新为 02110
  db.prepare("UPDATE settings SET value = '02110' WHERE key = 'stock_name' AND value = '模拟标的'").run();
}

export function seedData() {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as any;
  if (count.cnt > 0) return;

  const hash = bcrypt.hashSync('123456', 10);

  // 创建默认用户
  const insertUser = db.prepare(
    'INSERT INTO users (username, password_hash, real_name, role, balance) VALUES (?, ?, ?, ?, ?)'
  );

  insertUser.run('user1', hash, '张三', 'user', 1000000);
  insertUser.run('user2', hash, '李四', 'user', 1000000);
  insertUser.run('admin', hash, '王管理', 'admin', 0);
  insertUser.run('auditor', hash, '赵审核', 'admin', 0);

  // 初始化价格数据（最近24个10分钟段）
  const insertPrice = db.prepare(
    'INSERT OR IGNORE INTO stock_prices (open, high, low, close, volume, time_slot, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const now = new Date();
  let basePrice = 10.50;

  for (let i = 23; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 10 * 60 * 1000);
    const slot = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')} ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;

    const change = (Math.random() - 0.48) * 0.3;
    basePrice = Math.max(8, Math.min(15, basePrice + change));
    const open = Math.round(basePrice * 100) / 100;
    const close = Math.round((basePrice + (Math.random() - 0.5) * 0.4) * 100) / 100;
    const high = Math.round(Math.max(open, close) * 1.005 * 100) / 100;
    const low = Math.round(Math.min(open, close) * 0.995 * 100) / 100;

    insertPrice.run(open, high, low, close, Math.floor(Math.random() * 5000) + 1000, slot, 3);
  }

  // 初始化持仓（user1 持有 500 股）
  const p = db.prepare('SELECT close FROM stock_prices ORDER BY id DESC LIMIT 1').get() as any;
  const latestPrice = p?.close || 10.50;
  db.prepare('INSERT INTO positions (user_id, quantity, avg_cost) VALUES (?, ?, ?)').run(1, 500, latestPrice);

  // 初始化 user2 持仓
  db.prepare('INSERT INTO positions (user_id, quantity, avg_cost) VALUES (?, ?, ?)').run(2, 300, latestPrice - 0.5);

  console.log('✅ 种子数据已初始化');
}

export function logOperation(userId: number, username: string, action: string, detail: string) {
  db.prepare(
    'INSERT INTO operation_logs (user_id, username, action, detail) VALUES (?, ?, ?, ?)'
  ).run(userId, username, action, detail);
}

export default db;

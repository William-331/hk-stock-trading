import { Router, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, HeadingLevel } from 'docx';
import db, { logOperation } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';
import path from 'path';
import fs from 'fs';

const router = Router();
const BACKUP_DIR = path.join(__dirname, '..', '..', '..', 'data', 'backups');

function mapOrderType(type: unknown): string {
  return type === 'buy' ? '认购' : type === 'sell' ? '申请转让' : '未知类型';
}

function mapOrderStatus(status: unknown): string {
  return status === 'pending' ? '待审核' : status === 'approved' ? '已通过' : status === 'rejected' ? '已驳回' : '未知状态';
}

function mapAuditAction(action: unknown): string {
  return action === 'approve' ? '通过' : action === 'reject' ? '驳回' : '未知操作';
}

function mapUserStatus(status: unknown): string {
  return status === 'active' ? '正常' : status === 'frozen' ? '冻结' : '未知状态';
}

function mapUserRole(role: unknown): string {
  return role === 'admin' ? '管理员' : role === 'user' ? '用户' : '未知角色';
}

// ==================== Excel 导出 ====================

router.get('/trades', requireAuth, (req: Request, res: Response) => {
  const { startDate, endDate } = req.query;
  let query = `
    SELECT tr.id, u.username, u.real_name, tr.type, tr.quantity, tr.price, tr.amount, tr.created_at,
           COALESCE(p.quantity, 0) as position_qty
    FROM trade_records tr JOIN users u ON u.id = tr.user_id
    LEFT JOIN positions p ON p.user_id = tr.user_id WHERE 1=1
  `;
  const params: any[] = [];
  if (startDate) { query += ' AND tr.created_at >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND tr.created_at <= ?'; params.push(endDate + ' 23:59:59'); }
  query += ' ORDER BY tr.created_at DESC LIMIT 10000';
  const rows = db.prepare(query).all(...params);
  generateExcel(res, '认购与转让记录', ['ID', '用户名', '姓名', '意向类型', '权证数量', '参考估值', '参考金额', '权证持有量', '时间'], rows, (r: any) => [
    r.id, r.username, r.real_name, mapOrderType(r.type), r.quantity, r.price.toFixed(2), r.amount.toFixed(2), r.position_qty, r.created_at,
  ]);
});

// 导出认购与转让记录 CSV（与 /trades 相同的数据与过滤，输出 UTF-8 CSV）
router.get('/trades-csv', requireAuth, (req: Request, res: Response) => {
  const { startDate, endDate } = req.query;
  let query = `
    SELECT tr.id, u.username, u.real_name, tr.type, tr.quantity, tr.price, tr.amount, tr.created_at,
           COALESCE(p.quantity, 0) as position_qty
    FROM trade_records tr JOIN users u ON u.id = tr.user_id
    LEFT JOIN positions p ON p.user_id = tr.user_id WHERE 1=1
  `;
  const params: any[] = [];
  if (startDate) { query += ' AND tr.created_at >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND tr.created_at <= ?'; params.push(endDate + ' 23:59:59'); }
  query += ' ORDER BY tr.created_at DESC LIMIT 10000';
  const rows = db.prepare(query).all(...params);
  generateCsv(res, '认购与转让记录', ['ID', '用户名', '姓名', '意向类型', '权证数量', '参考估值', '参考金额', '权证持有量', '时间'], rows, (r: any) => [
    r.id, r.username, r.real_name, mapOrderType(r.type), r.quantity, r.price.toFixed(2), r.amount.toFixed(2), r.position_qty, r.created_at,
  ]);
});

router.get('/audit', requireAuth, (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT ar.id, u1.username as auditor, u2.username as applicant, o.type, o.quantity, o.price, ar.action, ar.comment, ar.created_at
    FROM audit_records ar JOIN orders o ON o.id = ar.order_id
    LEFT JOIN users u1 ON u1.id = ar.auditor_id LEFT JOIN users u2 ON u2.id = o.user_id
    ORDER BY ar.created_at DESC LIMIT 10000
  `).all();
  generateExcel(res, '意向审核记录', ['ID', '审核人', '申请人', '意向类型', '权证数量', '参考估值', '操作', '备注', '时间'], rows, (r: any) => [
    r.id, r.auditor, r.applicant, mapOrderType(r.type), r.quantity, r.price?.toFixed(2) || '-',
    mapAuditAction(r.action), r.comment, r.created_at,
  ]);
});

// 导出用户账号（含明文密码，仅管理员，演示用途）
router.get('/users', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const { search } = req.query;
  let query = `
    SELECT u.id, u.username, u.password_plain, u.real_name, u.role, u.balance, u.status,
           COALESCE(p.quantity, 0) as position_qty
    FROM users u LEFT JOIN positions p ON p.user_id = u.id`;
  const params: any[] = [];
  if (search) { query += ' WHERE u.username LIKE ? OR u.real_name LIKE ?'; params.push(`%${search}%`, `%${search}%`); }
  query += ' ORDER BY u.id';
  const rows = db.prepare(query).all(...params);
  logOperation(req.user!.id, req.user!.username, 'export_users', `导出用户账号 ${rows.length} 条`);
  generateExcel(res, '用户账号', ['ID', '用户名', '密码', '姓名', '角色', '余额', '权证持有量', '状态'], rows, (r: any) => [
    r.id, r.username, r.password_plain || '', r.real_name, mapUserRole(r.role),
    r.balance, r.position_qty, mapUserStatus(r.status),
  ]);
});

// ==================== Word 导出 ====================

router.get('/trades-word', requireAuth, async (req: Request, res: Response) => {
  const { startDate, endDate } = req.query;
  let query = `
    SELECT tr.id, u.username, u.real_name, tr.type, tr.quantity, tr.price, tr.amount, tr.created_at,
           COALESCE(p.quantity, 0) as position_qty
    FROM trade_records tr JOIN users u ON u.id = tr.user_id
    LEFT JOIN positions p ON p.user_id = tr.user_id WHERE 1=1
  `;
  const params: any[] = [];
  if (startDate) { query += ' AND tr.created_at >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND tr.created_at <= ?'; params.push(endDate + ' 23:59:59'); }
  query += ' ORDER BY tr.created_at DESC LIMIT 10000';
  const rows = db.prepare(query).all(...params) as any[];

  const headers = ['ID', '用户名', '姓名', '意向类型', '权证数量', '参考估值', '参考金额', '权证持有量', '时间'];
  const mapRow = (r: any) => [
    String(r.id), r.username, r.real_name, mapOrderType(r.type),
    String(r.quantity), r.price.toFixed(2), r.amount.toFixed(2), String(r.position_qty), r.created_at,
  ];

  const doc = buildWordDoc('认购与转让记录', headers, rows, mapRow);
  sendWord(res, doc, '认购与转让记录');
});

router.get('/audit-word', requireAuth, async (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT ar.id, u1.username as auditor, u2.username as applicant, o.type, o.quantity, o.price, ar.action, ar.comment, ar.created_at
    FROM audit_records ar JOIN orders o ON o.id = ar.order_id
    LEFT JOIN users u1 ON u1.id = ar.auditor_id LEFT JOIN users u2 ON u2.id = o.user_id
    ORDER BY ar.created_at DESC LIMIT 10000
  `).all() as any[];

  const headers = ['ID', '审核人', '申请人', '意向类型', '权证数量', '参考估值', '操作', '备注', '时间'];
  const mapRow = (r: any) => [
    String(r.id), r.auditor, r.applicant, mapOrderType(r.type),
    String(r.quantity), r.price?.toFixed(2) || '-', mapAuditAction(r.action), r.comment || '', r.created_at,
  ];

  const doc = buildWordDoc('意向审核记录', headers, rows, mapRow);
  sendWord(res, doc, '意向审核记录');
});

// ==================== 备份（Excel + Word 双格式） ====================

router.post('/backup', requireAuth, async (req: Request, res: Response) => {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;

  // 导出数据
  const trades = db.prepare('SELECT tr.*, u.username, u.real_name, COALESCE(p.quantity, 0) as position_qty FROM trade_records tr JOIN users u ON u.id = tr.user_id LEFT JOIN positions p ON p.user_id = tr.user_id ORDER BY tr.created_at DESC').all() as any[];
  const prices = db.prepare('SELECT * FROM stock_prices ORDER BY time_slot DESC LIMIT 1000').all() as any[];

  const results: string[] = [];

  // Excel 备份
  const xlsxFile = `认购与转让备份_${ts}.xlsx`;
  const xlsxPath = path.join(BACKUP_DIR, xlsxFile);
  const wb = new ExcelJS.Workbook();

  const s1 = wb.addWorksheet('认购与转让记录');
  s1.addRow(['ID', '用户名', '姓名', '意向类型', '权证数量', '参考估值', '参考金额', '权证持有量', '时间']);
  trades.forEach(r => s1.addRow([r.id, r.username, r.real_name, mapOrderType(r.type), r.quantity, r.price, r.amount, r.position_qty, r.created_at]));

  const s2 = wb.addWorksheet('参考估值数据');
  s2.addRow(['时间', '期初估值', '估值区间上沿', '估值区间下沿', '当前估值', '转让完成数']);
  prices.forEach(r => s2.addRow([r.time_slot, r.open, r.high, r.low, r.close, r.volume]));

  await wb.xlsx.writeFile(xlsxPath);
  results.push(xlsxFile);
  db.prepare('INSERT INTO backups (filename, type, record_count, created_by) VALUES (?, ?, ?, ?)').run(xlsxFile, 'xlsx', trades.length, req.user!.id);

  // Word 备份
  const docxFile = `认购与转让备份_${ts}.docx`;
  const docxPath = path.join(BACKUP_DIR, docxFile);

  const docHeaders = ['ID', '用户名', '姓名', '意向类型', '权证数量', '参考估值', '参考金额', '权证持有量', '时间'];
  const docMap = (r: any) => [String(r.id), r.username, r.real_name, mapOrderType(r.type), String(r.quantity), r.price.toFixed(2), r.amount.toFixed(2), String(r.position_qty), r.created_at];
  const doc = buildWordDoc('认购与转让记录', docHeaders, trades, docMap);
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(docxPath, buffer);
  results.push(docxFile);
  db.prepare('INSERT INTO backups (filename, type, record_count, created_by) VALUES (?, ?, ?, ?)').run(docxFile, 'docx', trades.length, req.user!.id);

  logOperation(req.user!.id, req.user!.username, 'backup', `备份: ${results.join(', ')}`);
  res.json({ message: '备份完成', files: results, count: trades.length });
});

// ==================== 自动备份（被 cron 调用） ====================

export async function autoBackup() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;

  const trades = db.prepare('SELECT tr.*, u.username, u.real_name, COALESCE(p.quantity, 0) as position_qty FROM trade_records tr JOIN users u ON u.id = tr.user_id LEFT JOIN positions p ON p.user_id = tr.user_id ORDER BY tr.created_at DESC').all() as any[];
  const audits = db.prepare(`
    SELECT ar.*, o.type, u1.username as auditor, u2.username as applicant
    FROM audit_records ar JOIN orders o ON o.id = ar.order_id
    LEFT JOIN users u1 ON u1.id = ar.auditor_id LEFT JOIN users u2 ON u2.id = o.user_id
    ORDER BY ar.created_at DESC
  `).all() as any[];
  const prices = db.prepare('SELECT * FROM stock_prices WHERE created_at >= ? ORDER BY time_slot DESC').all(dateStr) as any[];
  const positions = db.prepare('SELECT p.*, u.username, u.real_name FROM positions p JOIN users u ON u.id = p.user_id').all() as any[];
  const accounts = db.prepare('SELECT id, username, real_name, role, balance, status FROM users ORDER BY id').all() as any[];
  const dailyOrders = db.prepare(
    "SELECT o.*, u.username, u.real_name FROM orders o JOIN users u ON u.id = o.user_id WHERE o.created_at >= ? ORDER BY o.created_at DESC"
  ).all(dateStr) as any[];

  // Excel 每日汇总
  const xlsxFile = `每日合规备份_${dateStr}.xlsx`;
  const xlsxPath = path.join(BACKUP_DIR, xlsxFile);
  const wb = new ExcelJS.Workbook();

  const addSheet = (name: string, headers: string[], rows: any[], mapFn: (r: any) => any[]) => {
    const s = wb.addWorksheet(name);
    s.addRow(headers);
    rows.forEach(r => s.addRow(mapFn(r)));
  };

  // 今日摘要
  const s0 = wb.addWorksheet('每日汇总');
  const stockName = (db.prepare("SELECT value FROM settings WHERE key='stock_name'").get() as any)?.value || '天成控股';
  const latestPrice = prices.length > 0 ? prices[0] : null;
  s0.addRow([`${stockName} 每日认购与转让报告`]);
  s0.addRow([`日期: ${dateStr}`]);
  s0.addRow([`当日认购与转让笔数: ${trades.length}`]);
  s0.addRow([`当日意向数: ${dailyOrders.length}`]);
  if (latestPrice) {
    s0.addRow([`期初估值: ${latestPrice.open}`, `估值区间上沿: ${latestPrice.high}`, `估值区间下沿: ${latestPrice.low}`, `当前估值: ${latestPrice.close}`, `转让完成数: ${latestPrice.volume}`]);
  }
  s0.addRow([]);

  // 参考估值走势
  addSheet('参考估值走势', ['时间', '期初估值', '估值区间上沿', '估值区间下沿', '当前估值', '转让完成数'], prices, r => [r.time_slot, r.open, r.high, r.low, r.close, r.volume]);

  // 认购与转让记录
  addSheet('认购与转让记录', ['ID', '用户名', '姓名', '意向类型', '权证数量', '参考估值', '参考金额', '权证持有量', '时间'], trades, r => [r.id, r.username, r.real_name, mapOrderType(r.type), r.quantity, r.price, r.amount, r.position_qty, r.created_at]);

  // 当日意向
  addSheet('当日意向', ['ID', '用户名', '姓名', '意向类型', '权证数量', '参考估值', '状态', '时间'], dailyOrders, r => [r.id, r.username, r.real_name, mapOrderType(r.type), r.quantity, r.price, mapOrderStatus(r.status), r.created_at]);

  // 权证持有量汇总
  addSheet('权证持有量汇总', ['用户ID', '用户名', '姓名', '权证持有量', '平均成本'], positions, r => [r.user_id, r.username, r.real_name, r.quantity, r.avg_cost]);

  // 账户余额
  addSheet('账户余额', ['ID', '用户名', '姓名', '角色', '余额', '状态'], accounts, r => [r.id, r.username, r.real_name, mapUserRole(r.role), r.balance, mapUserStatus(r.status)]);

  // 意向审核记录
  addSheet('意向审核记录', ['ID', '审核人', '申请人', '意向类型', '权证数量', '参考估值', '操作', '备注', '时间'], audits, r => [r.id, r.auditor, r.applicant, mapOrderType(r.type), r.quantity, r.price, mapAuditAction(r.action), r.comment, r.created_at]);

  await wb.xlsx.writeFile(xlsxPath);
  db.prepare('INSERT INTO backups (filename, type, record_count) VALUES (?, ?, ?)').run(xlsxFile, 'auto_xlsx', trades.length);

  // Word
  const docxFile = `每日合规备份_${dateStr}.docx`;
  const docxPath = path.join(BACKUP_DIR, docxFile);
  const docHeaders = ['ID', '用户名', '姓名', '意向类型', '权证数量', '参考估值', '参考金额', '权证持有量', '时间'];
  const docMap = (r: any) => [String(r.id), r.username, r.real_name, mapOrderType(r.type), String(r.quantity), r.price.toFixed(2), r.amount.toFixed(2), String(r.position_qty), r.created_at];
  const doc = buildWordDoc('每日认购与转让备份', docHeaders, trades, docMap);
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(docxPath, buf);
  db.prepare('INSERT INTO backups (filename, type, record_count) VALUES (?, ?, ?)').run(docxFile, 'auto_docx', trades.length);

  console.log(`[auto-backup] ${dateStr}: 每日汇总已生成 (${trades.length} 笔认购与转让, ${prices.length} 条参考估值, ${positions.length} 个权证持有量记录)`);
}

// ==================== 手动每日汇总 ====================
router.post('/daily-summary', requireAuth, async (req: Request, res: Response) => {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const { date } = req.body;
  const now = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  const dateStr = date || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const trades = db.prepare('SELECT tr.*, u.username, u.real_name, COALESCE(p.quantity, 0) as position_qty FROM trade_records tr JOIN users u ON u.id = tr.user_id LEFT JOIN positions p ON p.user_id = tr.user_id WHERE tr.created_at >= ? AND tr.created_at <= ? ORDER BY tr.created_at DESC').all(dateStr, dateStr + ' 23:59:59') as any[];
  const prices = db.prepare("SELECT * FROM stock_prices WHERE time_slot LIKE ? ORDER BY time_slot ASC").all(dateStr + '%') as any[];
  const dailyOrders = db.prepare("SELECT o.*, u.username, u.real_name FROM orders o JOIN users u ON u.id = o.user_id WHERE o.created_at >= ? AND o.created_at <= ? ORDER BY o.created_at DESC").all(dateStr, dateStr + ' 23:59:59') as any[];
  const positions = db.prepare('SELECT p.*, u.username, u.real_name FROM positions p JOIN users u ON u.id = p.user_id').all() as any[];
  const accounts = db.prepare('SELECT id, username, real_name, role, balance, status FROM users ORDER BY id').all() as any[];

  const stockName = (db.prepare("SELECT value FROM settings WHERE key='stock_name'").get() as any)?.value || '天成控股';
  const latestPrice = prices.length > 0 ? prices[prices.length - 1] : null;

  const wb = new ExcelJS.Workbook();

  // 汇总页
  const s0 = wb.addWorksheet('每日汇总');
  s0.addRow([`${stockName} 每日认购与转让报告`]);
  s0.addRow([`日期: ${dateStr}`]);
  s0.addRow([`认购与转让笔数: ${trades.length}`]);
  s0.addRow([`意向数: ${dailyOrders.length}`]);
  if (latestPrice) {
    s0.addRow([`期初估值: ${latestPrice.open}  估值区间上沿: ${latestPrice.high}  估值区间下沿: ${latestPrice.low}  当前估值: ${latestPrice.close}  转让完成数: ${latestPrice.volume}`]);
  }
  s0.addRow([]);

  // 参考估值走势
  const s1 = wb.addWorksheet('参考估值走势');
  s1.addRow(['时间', '期初估值', '估值区间上沿', '估值区间下沿', '当前估值', '转让完成数']);
  prices.forEach(r => s1.addRow([r.time_slot, r.open, r.high, r.low, r.close, r.volume]));

  // 认购与转让记录
  const s2 = wb.addWorksheet('认购与转让记录');
  s2.addRow(['ID', '用户名', '姓名', '意向类型', '权证数量', '参考估值', '参考金额', '权证持有量', '时间']);
  trades.forEach(r => s2.addRow([r.id, r.username, r.real_name, mapOrderType(r.type), r.quantity, r.price, r.amount, r.position_qty, r.created_at]));

  // 当日意向
  const s3 = wb.addWorksheet('当日意向');
  s3.addRow(['ID', '用户名', '姓名', '意向类型', '权证数量', '参考估值', '状态', '时间']);
  dailyOrders.forEach(r => s3.addRow([r.id, r.username, r.real_name, mapOrderType(r.type), r.quantity, r.price, mapOrderStatus(r.status), r.created_at]));

  // 权证持有量
  const s4 = wb.addWorksheet('权证持有量汇总');
  s4.addRow(['用户ID', '用户名', '姓名', '权证持有量', '平均成本']);
  positions.forEach(r => s4.addRow([r.user_id, r.username, r.real_name, r.quantity, r.avg_cost]));

  // 账户
  const s5 = wb.addWorksheet('账户余额');
  s5.addRow(['ID', '用户名', '姓名', '角色', '余额', '状态']);
  accounts.forEach(r => s5.addRow([r.id, r.username, r.real_name, mapUserRole(r.role), r.balance, mapUserStatus(r.status)]));

  const ts = dateStr.replace(/-/g, '');
  const xlsxFile = `每日合规汇总_${ts}.xlsx`;
  const xlsxPath = path.join(BACKUP_DIR, xlsxFile);
  await wb.xlsx.writeFile(xlsxPath);

  db.prepare('INSERT INTO backups (filename, type, record_count, created_by) VALUES (?, ?, ?, ?)').run(xlsxFile, 'daily_summary', trades.length, req.user!.id);
  logOperation(req.user!.id, req.user!.username, 'daily_summary', `每日汇总: ${dateStr}`);

  res.download(xlsxPath, xlsxFile);
});

// ==================== 备份列表/下载 ====================

router.get('/backup/list', requireAuth, (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM backups ORDER BY created_at DESC LIMIT 50').all();
  res.json(rows);
});

router.get('/backup/download/:id', requireAuth, (req: Request, res: Response) => {
  const backup = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id) as any;
  if (!backup) return res.status(404).json({ error: '不存在' });
  const filepath = path.join(BACKUP_DIR, backup.filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: '文件不存在' });
  logOperation(req.user!.id, req.user!.username, 'download_backup', `下载: ${backup.filename}`);
  res.download(filepath, backup.filename);
});

// ==================== 工具函数 ====================

function generateExcel(res: Response, sheetName: string, headers: string[], rows: any[], mapFn: (r: any) => any[]) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(sheetName);
  sheet.addRow(headers);
  rows.forEach(r => sheet.addRow(mapFn(r)));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(sheetName)}_${Date.now()}.xlsx"`);
  wb.xlsx.write(res).then(() => res.end());
}

function generateCsv(res: Response, filename: string, headers: string[], rows: any[], mapFn: (r: any) => any[]) {
  const escape = (v: any) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(',')];
  for (const r of rows) lines.push(mapFn(r).map(escape).join(','));
  // 前置 BOM，让 Excel 打开时正确识别 UTF-8 中文，避免乱码
  const csv = '﻿' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}_${Date.now()}.csv"`);
  res.send(csv);
}

function buildWordDoc(title: string, headers: string[], rows: any[], mapFn: (r: any) => any[]) {
  const stockName = (db.prepare("SELECT value FROM settings WHERE key = 'stock_name'").get() as any)?.value || '天成控股';

  const children: any[] = [
    new Paragraph({ text: `${stockName} - ${title}`, heading: HeadingLevel.HEADING_1, spacing: { after: 300 } }),
    new Paragraph({ text: `导出时间: ${new Date().toLocaleString('zh-CN')}`, spacing: { after: 300 } }),
  ];

  if (rows.length === 0) {
    children.push(new Paragraph({ text: '暂无数据', spacing: { after: 200 } }));
  } else {
    const tableRows: TableRow[] = [
      new TableRow({ children: headers.map(h => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })], width: { size: 1500, type: WidthType.DXA } })) }),
      ...rows.map(r =>
        new TableRow({ children: mapFn(r).map((v: string) => new TableCell({ children: [new Paragraph(String(v))] })) })
      ),
    ];
    children.push(new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
  }

  return new Document({ sections: [{ properties: {}, children }] });
}

async function sendWord(res: Response, doc: Document, filename: string) {
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}_${Date.now()}.docx"`);
  res.send(buffer);
}

export default router;

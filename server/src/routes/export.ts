import { Router, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, HeadingLevel } from 'docx';
import db, { logOperation } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';
import path from 'path';
import fs from 'fs';

const router = Router();
const BACKUP_DIR = path.join(__dirname, '..', '..', '..', 'data', 'backups');

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
  generateExcel(res, '交易记录', ['ID', '用户名', '姓名', '类型', '数量', '价格', '金额', '持仓', '时间'], rows, (r: any) => [
    r.id, r.username, r.real_name, r.type === 'buy' ? '买入' : '卖出', r.quantity, r.price.toFixed(2), r.amount.toFixed(2), r.position_qty, r.created_at,
  ]);
});

// 导出交易记录 CSV（与 /trades 相同的数据与过滤，输出 UTF-8 CSV）
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
  generateCsv(res, '交易记录', ['ID', '用户名', '姓名', '类型', '数量', '价格', '金额', '持仓', '时间'], rows, (r: any) => [
    r.id, r.username, r.real_name, r.type === 'buy' ? '买入' : '卖出', r.quantity, r.price.toFixed(2), r.amount.toFixed(2), r.position_qty, r.created_at,
  ]);
});

router.get('/audit', requireAuth, (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT ar.id, u1.username as auditor, u2.username as applicant, o.type, o.quantity, o.price, ar.action, ar.comment, ar.created_at
    FROM audit_records ar JOIN orders o ON o.id = ar.order_id
    LEFT JOIN users u1 ON u1.id = ar.auditor_id LEFT JOIN users u2 ON u2.id = o.user_id
    ORDER BY ar.created_at DESC LIMIT 10000
  `).all();
  generateExcel(res, '审批记录', ['ID', '审核人', '申请人', '类型', '数量', '价格', '操作', '备注', '时间'], rows, (r: any) => [
    r.id, r.auditor, r.applicant, r.type === 'buy' ? '买入' : '卖出', r.quantity, r.price?.toFixed(2) || '-',
    r.action === 'approve' ? '通过' : '驳回', r.comment, r.created_at,
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
  generateExcel(res, '用户账号', ['ID', '用户名', '密码', '姓名', '角色', '余额', '持仓', '状态'], rows, (r: any) => [
    r.id, r.username, r.password_plain || '', r.real_name, r.role === 'admin' ? '管理员' : '用户',
    r.balance, r.position_qty, r.status === 'active' ? '正常' : '冻结',
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

  const headers = ['ID', '用户名', '姓名', '类型', '数量', '价格', '金额', '持仓', '时间'];
  const mapRow = (r: any) => [
    String(r.id), r.username, r.real_name, r.type === 'buy' ? '买入' : '卖出',
    String(r.quantity), r.price.toFixed(2), r.amount.toFixed(2), String(r.position_qty), r.created_at,
  ];

  const doc = buildWordDoc('交易记录', headers, rows, mapRow);
  sendWord(res, doc, '交易记录');
});

router.get('/audit-word', requireAuth, async (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT ar.id, u1.username as auditor, u2.username as applicant, o.type, o.quantity, o.price, ar.action, ar.comment, ar.created_at
    FROM audit_records ar JOIN orders o ON o.id = ar.order_id
    LEFT JOIN users u1 ON u1.id = ar.auditor_id LEFT JOIN users u2 ON u2.id = o.user_id
    ORDER BY ar.created_at DESC LIMIT 10000
  `).all() as any[];

  const headers = ['ID', '审核人', '申请人', '类型', '数量', '价格', '操作', '备注', '时间'];
  const mapRow = (r: any) => [
    String(r.id), r.auditor, r.applicant, r.type === 'buy' ? '买入' : '卖出',
    String(r.quantity), r.price?.toFixed(2) || '-', r.action === 'approve' ? '通过' : '驳回', r.comment || '', r.created_at,
  ];

  const doc = buildWordDoc('审批记录', headers, rows, mapRow);
  sendWord(res, doc, '审批记录');
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
  const xlsxFile = `backup_${ts}.xlsx`;
  const xlsxPath = path.join(BACKUP_DIR, xlsxFile);
  const wb = new ExcelJS.Workbook();

  const s1 = wb.addWorksheet('交易记录');
  s1.addRow(['ID', '用户名', '姓名', '类型', '数量', '价格', '金额', '持仓', '时间']);
  trades.forEach(r => s1.addRow([r.id, r.username, r.real_name, r.type, r.quantity, r.price, r.amount, r.position_qty, r.created_at]));

  const s2 = wb.addWorksheet('价格数据');
  s2.addRow(['时间', '开盘', '最高', '最低', '收盘', '成交量']);
  prices.forEach(r => s2.addRow([r.time_slot, r.open, r.high, r.low, r.close, r.volume]));

  await wb.xlsx.writeFile(xlsxPath);
  results.push(xlsxFile);
  db.prepare('INSERT INTO backups (filename, type, record_count, created_by) VALUES (?, ?, ?, ?)').run(xlsxFile, 'xlsx', trades.length, req.user!.id);

  // Word 备份
  const docxFile = `backup_${ts}.docx`;
  const docxPath = path.join(BACKUP_DIR, docxFile);

  const docHeaders = ['ID', '用户名', '姓名', '类型', '数量', '价格', '金额', '持仓', '时间'];
  const docMap = (r: any) => [String(r.id), r.username, r.real_name, r.type, String(r.quantity), r.price.toFixed(2), r.amount.toFixed(2), String(r.position_qty), r.created_at];
  const doc = buildWordDoc('交易记录', docHeaders, trades, docMap);
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
    SELECT ar.*, u1.username as auditor, u2.username as applicant
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
  const xlsxFile = `auto_backup_${dateStr}.xlsx`;
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
  s0.addRow([`${stockName} 每日交易报告`]);
  s0.addRow([`日期: ${dateStr}`]);
  s0.addRow([`当日交易笔数: ${trades.length}`]);
  s0.addRow([`当日订单数: ${dailyOrders.length}`]);
  if (latestPrice) {
    s0.addRow([`开盘: ${latestPrice.open}`, `最高: ${latestPrice.high}`, `最低: ${latestPrice.low}`, `收盘: ${latestPrice.close}`, `成交量: ${latestPrice.volume}`]);
  }
  s0.addRow([]);

  // 价格走势
  addSheet('价格走势', ['时间', '开盘', '最高', '最低', '收盘', '成交量'], prices, r => [r.time_slot, r.open, r.high, r.low, r.close, r.volume]);

  // 交易记录
  addSheet('交易记录', ['ID', '用户名', '姓名', '类型', '数量', '价格', '金额', '持仓', '时间'], trades, r => [r.id, r.username, r.real_name, r.type, r.quantity, r.price, r.amount, r.position_qty, r.created_at]);

  // 当日订单
  addSheet('当日订单', ['ID', '用户名', '姓名', '类型', '数量', '价格', '状态', '时间'], dailyOrders, r => [r.id, r.username, r.real_name, r.type === 'buy' ? '买入' : '卖出', r.quantity, r.price, r.status, r.created_at]);

  // 持仓汇总
  addSheet('持仓汇总', ['用户ID', '用户名', '姓名', '持仓数量', '平均成本'], positions, r => [r.user_id, r.username, r.real_name, r.quantity, r.avg_cost]);

  // 账户余额
  addSheet('账户余额', ['ID', '用户名', '姓名', '角色', '余额', '状态'], accounts, r => [r.id, r.username, r.real_name, r.role, r.balance, r.status]);

  // 审批记录
  addSheet('审批记录', ['ID', '审核人', '申请人', '类型', '数量', '价格', '操作', '备注', '时间'], audits, r => [r.id, r.auditor, r.applicant, r.type, r.quantity, r.price, r.action, r.comment, r.created_at]);

  await wb.xlsx.writeFile(xlsxPath);
  db.prepare('INSERT INTO backups (filename, type, record_count) VALUES (?, ?, ?)').run(xlsxFile, 'auto_xlsx', trades.length);

  // Word
  const docxFile = `auto_backup_${dateStr}.docx`;
  const docxPath = path.join(BACKUP_DIR, docxFile);
  const docHeaders = ['ID', '用户名', '姓名', '类型', '数量', '价格', '金额', '持仓', '时间'];
  const docMap = (r: any) => [String(r.id), r.username, r.real_name, r.type, String(r.quantity), r.price.toFixed(2), r.amount.toFixed(2), String(r.position_qty), r.created_at];
  const doc = buildWordDoc('每日交易备份', docHeaders, trades, docMap);
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(docxPath, buf);
  db.prepare('INSERT INTO backups (filename, type, record_count) VALUES (?, ?, ?)').run(docxFile, 'auto_docx', trades.length);

  console.log(`[auto-backup] ${dateStr}: 每日汇总已生成 (${trades.length} 笔交易, ${prices.length} 条价格, ${positions.length} 个持仓)`);
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
  s0.addRow([`${stockName} 每日交易报告`]);
  s0.addRow([`日期: ${dateStr}`]);
  s0.addRow([`交易笔数: ${trades.length}`]);
  s0.addRow([`订单数: ${dailyOrders.length}`]);
  if (latestPrice) {
    s0.addRow([`开盘: ${latestPrice.open}  最高: ${latestPrice.high}  最低: ${latestPrice.low}  收盘: ${latestPrice.close}  成交量: ${latestPrice.volume}`]);
  }
  s0.addRow([]);

  // 价格走势
  const s1 = wb.addWorksheet('价格走势');
  s1.addRow(['时间', '开盘', '最高', '最低', '收盘', '成交量']);
  prices.forEach(r => s1.addRow([r.time_slot, r.open, r.high, r.low, r.close, r.volume]));

  // 交易记录
  const s2 = wb.addWorksheet('交易记录');
  s2.addRow(['ID', '用户名', '姓名', '类型', '数量', '价格', '金额', '持仓', '时间']);
  trades.forEach(r => s2.addRow([r.id, r.username, r.real_name, r.type === 'buy' ? '买入' : '卖出', r.quantity, r.price, r.amount, r.position_qty, r.created_at]));

  // 当日订单
  const s3 = wb.addWorksheet('当日订单');
  s3.addRow(['ID', '用户名', '姓名', '类型', '数量', '价格', '状态', '时间']);
  dailyOrders.forEach(r => s3.addRow([r.id, r.username, r.real_name, r.type === 'buy' ? '买入' : '卖出', r.quantity, r.price, r.status, r.created_at]));

  // 持仓
  const s4 = wb.addWorksheet('持仓汇总');
  s4.addRow(['用户ID', '用户名', '姓名', '持仓数量', '平均成本']);
  positions.forEach(r => s4.addRow([r.user_id, r.username, r.real_name, r.quantity, r.avg_cost]));

  // 账户
  const s5 = wb.addWorksheet('账户余额');
  s5.addRow(['ID', '用户名', '姓名', '角色', '余额', '状态']);
  accounts.forEach(r => s5.addRow([r.id, r.username, r.real_name, r.role, r.balance, r.status]));

  const ts = dateStr.replace(/-/g, '');
  const xlsxFile = `daily_summary_${ts}.xlsx`;
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
  const stockName = (db.prepare("SELECT value FROM settings WHERE key = 'stock_name'").get() as any)?.value || '02110';

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

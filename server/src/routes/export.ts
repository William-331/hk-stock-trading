import { Router, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, HeadingLevel } from 'docx';
import db, { logOperation } from '../db';
import { requireAuth } from '../middleware/auth';
import path from 'path';
import fs from 'fs';

const router = Router();
const BACKUP_DIR = path.join(__dirname, '..', '..', '..', 'data', 'backups');

// ==================== Excel 导出 ====================

router.get('/trades', requireAuth, (req: Request, res: Response) => {
  const { startDate, endDate } = req.query;
  let query = `
    SELECT tr.id, u.username, u.real_name, tr.type, tr.quantity, tr.price, tr.amount, tr.created_at
    FROM trade_records tr JOIN users u ON u.id = tr.user_id WHERE 1=1
  `;
  const params: any[] = [];
  if (startDate) { query += ' AND tr.created_at >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND tr.created_at <= ?'; params.push(endDate + ' 23:59:59'); }
  query += ' ORDER BY tr.created_at DESC LIMIT 10000';
  const rows = db.prepare(query).all(...params);
  generateExcel(res, '交易记录', ['ID', '用户名', '姓名', '类型', '数量', '价格', '金额', '时间'], rows, (r: any) => [
    r.id, r.username, r.real_name, r.type === 'buy' ? '买入' : '卖出', r.quantity, r.price.toFixed(2), r.amount.toFixed(2), r.created_at,
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

// ==================== Word 导出 ====================

router.get('/trades-word', requireAuth, async (req: Request, res: Response) => {
  const { startDate, endDate } = req.query;
  let query = `
    SELECT tr.id, u.username, u.real_name, tr.type, tr.quantity, tr.price, tr.amount, tr.created_at
    FROM trade_records tr JOIN users u ON u.id = tr.user_id WHERE 1=1
  `;
  const params: any[] = [];
  if (startDate) { query += ' AND tr.created_at >= ?'; params.push(startDate); }
  if (endDate) { query += ' AND tr.created_at <= ?'; params.push(endDate + ' 23:59:59'); }
  query += ' ORDER BY tr.created_at DESC LIMIT 10000';
  const rows = db.prepare(query).all(...params) as any[];

  const headers = ['ID', '用户名', '姓名', '类型', '数量', '价格', '金额', '时间'];
  const mapRow = (r: any) => [
    String(r.id), r.username, r.real_name, r.type === 'buy' ? '买入' : '卖出',
    String(r.quantity), r.price.toFixed(2), r.amount.toFixed(2), r.created_at,
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
  const trades = db.prepare('SELECT tr.*, u.username, u.real_name FROM trade_records tr JOIN users u ON u.id = tr.user_id ORDER BY tr.created_at DESC').all() as any[];
  const prices = db.prepare('SELECT * FROM stock_prices ORDER BY time_slot DESC LIMIT 1000').all() as any[];

  const results: string[] = [];

  // Excel 备份
  const xlsxFile = `backup_${ts}.xlsx`;
  const xlsxPath = path.join(BACKUP_DIR, xlsxFile);
  const wb = new ExcelJS.Workbook();

  const s1 = wb.addWorksheet('交易记录');
  s1.addRow(['ID', '用户名', '姓名', '类型', '数量', '价格', '金额', '时间']);
  trades.forEach(r => s1.addRow([r.id, r.username, r.real_name, r.type, r.quantity, r.price, r.amount, r.created_at]));

  const s2 = wb.addWorksheet('价格数据');
  s2.addRow(['时间', '开盘', '最高', '最低', '收盘', '成交量']);
  prices.forEach(r => s2.addRow([r.time_slot, r.open, r.high, r.low, r.close, r.volume]));

  await wb.xlsx.writeFile(xlsxPath);
  results.push(xlsxFile);
  db.prepare('INSERT INTO backups (filename, type, record_count, created_by) VALUES (?, ?, ?, ?)').run(xlsxFile, 'xlsx', trades.length, req.user!.id);

  // Word 备份
  const docxFile = `backup_${ts}.docx`;
  const docxPath = path.join(BACKUP_DIR, docxFile);

  const docHeaders = ['ID', '用户名', '姓名', '类型', '数量', '价格', '金额', '时间'];
  const docMap = (r: any) => [String(r.id), r.username, r.real_name, r.type, String(r.quantity), r.price.toFixed(2), r.amount.toFixed(2), r.created_at];
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

  const trades = db.prepare('SELECT tr.*, u.username, u.real_name FROM trade_records tr JOIN users u ON u.id = tr.user_id ORDER BY tr.created_at DESC').all() as any[];
  const audits = db.prepare(`
    SELECT ar.*, u1.username as auditor, u2.username as applicant
    FROM audit_records ar JOIN orders o ON o.id = ar.order_id
    LEFT JOIN users u1 ON u1.id = ar.auditor_id LEFT JOIN users u2 ON u2.id = o.user_id
    ORDER BY ar.created_at DESC
  `).all() as any[];
  const prices = db.prepare('SELECT * FROM stock_prices WHERE created_at >= ? ORDER BY time_slot DESC').all(dateStr) as any[];

  // Excel
  const xlsxFile = `auto_backup_${dateStr}.xlsx`;
  const xlsxPath = path.join(BACKUP_DIR, xlsxFile);
  const wb = new ExcelJS.Workbook();

  const s1 = wb.addWorksheet('交易记录');
  s1.addRow(['ID', '用户名', '姓名', '类型', '数量', '价格', '金额', '时间']);
  trades.forEach(r => s1.addRow([r.id, r.username, r.real_name, r.type, r.quantity, r.price, r.amount, r.created_at]));

  const s2 = wb.addWorksheet('审批记录');
  s2.addRow(['ID', '审核人', '申请人', '类型', '数量', '价格', '操作', '备注', '时间']);
  audits.forEach(r => s2.addRow([r.id, r.auditor, r.applicant, r.type, r.quantity, r.price, r.action, r.comment, r.created_at]));

  const s3 = wb.addWorksheet('价格快照');
  s3.addRow(['时间', '开盘', '最高', '最低', '收盘', '成交量']);
  prices.forEach(r => s3.addRow([r.time_slot, r.open, r.high, r.low, r.close, r.volume]));

  await wb.xlsx.writeFile(xlsxPath);
  db.prepare('INSERT INTO backups (filename, type, record_count) VALUES (?, ?, ?)').run(xlsxFile, 'auto_xlsx', trades.length);

  // Word
  const docxFile = `auto_backup_${dateStr}.docx`;
  const docxPath = path.join(BACKUP_DIR, docxFile);
  const docHeaders = ['ID', '用户名', '姓名', '类型', '数量', '价格', '金额', '时间'];
  const docMap = (r: any) => [String(r.id), r.username, r.real_name, r.type, String(r.quantity), r.price.toFixed(2), r.amount.toFixed(2), r.created_at];
  const doc = buildWordDoc('每日交易备份', docHeaders, trades, docMap);
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(docxPath, buf);
  db.prepare('INSERT INTO backups (filename, type, record_count) VALUES (?, ?, ?)').run(docxFile, 'auto_docx', trades.length);

  console.log(`[auto-backup] ${dateStr}: Excel + Word 已备份 (${trades.length} 笔交易, ${prices.length} 条价格)`);
}

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

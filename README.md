# 📈 港股模拟交易系统

内部演练用的港股模拟交易平台，支持实时港股行情、模拟下单、审核流程、K线图表、交易记录备份。

## 功能概览

### 普通用户
- **行情中心** — 02110 模拟盘 K 线图 + 买卖下单
- **港股行情** — 15 只热门港股实时行情表格（涨跌幅、涨速、换手、量比、振幅、成交额、流通市值、市盈率）
- **持仓管理** — 查看当前持仓和成交记录
- **申请记录** — 查看提交的买卖申请及审核状态

### 管理员
- **仪表盘** — 用户数、待审核、成交统计概览
- **审批管理** — 审核买卖申请（通过 / 拒绝）
- **控价管理** — 手动设置 02110 价格（K 线数据）
- **交易记录** — 所有成交记录查询、Excel/Word 导出、自动备份

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS |
| 图表 | lightweight-charts (TradingView) |
| 后端 | Express + TypeScript + better-sqlite3 |
| 认证 | JWT |
| 数据 | 东方财富 API（实时港股）、SQLite |
| 导出 | exceljs + docx |

## 快速启动

```bash
# 1. 安装依赖
npm run install:all

# 2. 启动开发模式（前后端同时启动）
npm run dev
```

浏览器自动打开 `http://localhost:5173`

### 测试账户

| 账号 | 密码 | 角色 |
|------|------|------|
| user1 | 123456 | 普通用户 |
| admin | 123456 | 管理员 |

## 生产部署

```bash
# 1. 安装依赖
npm run install:all

# 2. 构建前端
npm run build

# 3. 编译后端
cd server && npm run build && cd ..

# 4. 启动生产服务（单端口 3001）
npm run start:prod
```

访问 `http://localhost:3001`

## 项目结构

```
股票/
├── client/               # React 前端
│   └── src/
│       ├── api/          # API 调用
│       ├── components/   # 通用组件 (Navbar, KlineChart)
│       └── pages/        # 页面 (Market, HKMarket, Login, ...)
├── server/               # Express 后端
│   └── src/
│       ├── routes/       # 路由 (auth, stocks, orders, audit, market, ...)
│       ├── middleware/   # JWT 认证中间件
│       ├── db.ts         # 数据库初始化
│       └── index.ts      # 入口
├── start.bat             # Windows 一键启动脚本
└── package.json          # 根配置（concurrently 启动前后端）
```

## 港股数据字段

| 字段 | 说明 |
|------|------|
| 最新价 | 实时成交价 |
| 涨跌幅 | 相对昨收涨跌百分比 |
| 涨速 | 5 分钟涨速 |
| 换手 | 换手率 |
| 量比 | 成交量比率 |
| 振幅 | (最高-最低)/今开 |
| 成交额 | 当日累计成交额 |
| 流通市值 | 流通股本 × 股价 |
| 市盈率 | 动态市盈率 |

数据来源：东方财富，每 5 秒自动刷新。

## License

MIT

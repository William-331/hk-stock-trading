# 天成控股 02110.HK 权证信息查阅与意向管理平台

面向内部使用的权证信息查阅与意向管理平台，支持参考估值信息查阅、意向提交、审核流程、每日估值区间图和记录备份。

## 功能概览

### 普通用户
- **参考估值展示** — 最近30个自然日每日参考估值点及历史波动区间（不含技术指标）
- **公共港股信息** — 15 只热门港股公开信息表格
- **我的权证** — 查看权证持有量和认购与转让记录
- **意向记录** — 查看提交的认购或转让意向及审核状态

### 管理员
- **仪表盘** — 用户数、待审核及认购与转让统计概览
- **意向审核** — 审核认购与转让意向（通过 / 拒绝）
- **参考估值管理** — 设置 02110 参考估值计划并查看每日估值区间
- **认购与转让记录** — 记录查询、Excel/Word 导出和自动备份

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
│       ├── components/   # 通用组件 (Navbar, ValuationRangeChart)
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

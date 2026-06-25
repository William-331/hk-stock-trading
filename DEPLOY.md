# 部署文档(Alibaba Cloud Linux 3 / 香港轻量服务器)

港股交易模拟系统的生产部署步骤。系统:Alibaba Cloud Linux 3(RHEL 8 系,用 yum/dnf)。

后端端口:**3001**(代码已支持用环境变量 `PORT` 覆盖)。

---

## 1. 装环境(Node 24 + 编译工具)

```bash
# 编译工具链(better-sqlite3 原生模块兜底用)
sudo yum install -y git gcc gcc-c++ make python3

# 装 Node 24
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo yum install -y nodejs

# 验证
node -v        # 期望 v24.x
npm -v

# pm2:让程序后台常驻、崩溃自动重启
sudo npm install -g pm2
```

> 若 `node -v` 报 `GLIBC_xx not found`,改用 Node 22 LTS(把上面 `setup_24.x` 换成 `setup_22.x`),项目完全兼容。

## 2. 拉代码、装依赖、构建

```bash
git clone https://github.com/William-331/hk-stock-trading.git
cd hk-stock-trading
npm run install:all    # 装前后端依赖
npm run build          # 编译前端 + 后端
```

> 若 better-sqlite3 报编译错误,确认第 1 步的 `gcc-c++ make python3` 都装了,再重跑 `npm run install:all`。

## 3. 配置环境变量(重要:JWT 密钥)

生成一个随机密钥并写入 server 的环境文件:

```bash
# 生成随机密钥
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

把输出的那串复制下来,创建 `server/.env`(此文件已被 .gitignore 忽略,不会进 git):

```bash
cd ~/hk-stock-trading/server
cat > .env <<EOF
NODE_ENV=production
PORT=3001
JWT_SECRET=把上面生成的随机串粘贴到这里
EOF
```

## 4. 用 pm2 常驻运行

```bash
cd ~/hk-stock-trading/server
pm2 start dist/index.js --name stock
pm2 save
pm2 startup    # 它会输出一行 sudo 命令,复制并执行那一行实现开机自启
```

验证:`pm2 logs stock` 应看到 `🚀 服务已启动`,且**没有** JWT 警告(有警告说明 .env 没读到)。

## 5. Nginx 反向代理 + HTTPS

```bash
sudo yum install -y nginx certbot python3-certbot-nginx
sudo systemctl enable --now nginx
```

新建 `/etc/nginx/conf.d/stock.conf`:

```nginx
server {
    listen 80;
    server_name 你的域名;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d 你的域名    # 申请免费 SSL,自动改为 https
```

## 6. 放行端口

在**阿里云控制台 → 轻量服务器 → 防火墙**放行 `80` 和 `443`。
不要对外开放 3001(只让 Nginx 内部转发即可)。

---

## 日常运维

```bash
pm2 restart stock      # 重启
pm2 logs stock         # 看日志
pm2 stop stock         # 停止

# 更新代码后重新部署
cd ~/hk-stock-trading && git pull && npm run build && pm2 restart stock
```

## 数据备份

数据库在 `server/data/trading.db`。定期备份:

```bash
cp ~/hk-stock-trading/server/data/trading.db ~/trading_backup_$(date +%Y%m%d).db
```

---

## 上线后默认账号

- 管理员:`admin / 123456`(**上线后请立即在用户管理页改掉**)
- 系统会自动建表;首次启动若是新库会自动播种种子数据。

## 安全提醒

- JWT 密钥已改为从环境变量读取,**务必**在 `.env` 配置随机 `JWT_SECRET`,否则会回退到公开的默认密钥。
- 本系统为演示用途,采用明文密码存储(后台可见)。请勿用于真实资金或真实个人信息。

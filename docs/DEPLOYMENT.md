# 部署说明

## 本地开发

```bash
node -v            # 需要 Node.js >= 22.5（node:sqlite）
npm install
cp .env.example .env
npm run dev        # --watch 热重载, http://localhost:3000
```

无 API Key 时默认 `AI_PROVIDER=mock`，全部功能（含翻译与 AI 审校管线）可离线运行，输出确定性结果，便于开发与测试。

## 接入真实 AI

`.env` 中配置任意 OpenAI 兼容端点（OpenAI、Azure OpenAI 代理、DeepSeek、Moonshot 等均可）：

```env
AI_PROVIDER=openai
AI_API_KEY=sk-...              # 仅存服务端，前端代码无任何引用
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
AI_TIMEOUT_MS=60000
AI_MAX_RETRIES=2
```

成本统计使用 `src/lib/ai/provider.js` 中的 `COST_PER_1K` 价目表，按所用模型更新。

## 生产部署

### 单机（PM2 / systemd）

```bash
npm ci --omit=dev
NODE_ENV=production npm start
```

```ini
# /etc/systemd/system/l10n.service
[Unit]
Description=L10N Assistant
After=network.target

[Service]
WorkingDirectory=/opt/l10n-assistant
EnvironmentFile=/opt/l10n-assistant/.env
ExecStart=/usr/bin/npm start
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

### Docker（示例 Dockerfile）

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/app.db
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t l10n-assistant .
docker run -d -p 3000:3000 --env-file .env -v l10n-data:/data l10n-assistant
```

### 反向代理（Nginx）

```nginx
server {
  listen 80;
  server_name l10n.example.com;
  client_max_body_size 10m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;   # 扫描与翻译可能耗时较长
  }
}
```

## 生产检查清单

- [ ] `ADMIN_TOKEN` 已更换为强随机值
- [ ] `AI_API_KEY` 仅存在于服务端环境变量（前端代码零引用，仓库忽略 `.env`）
- [ ] `DATABASE_PATH` 指向持久化卷，并定期备份 SQLite 文件
- [ ] 扫描限额（`SCAN_MAX_PAGES` 等）按服务器出网能力调整
- [ ] 出站防火墙：扫描器仅需出网 80/443；可在网关层进一步限制目的端口
- [ ] 额度配置（免费诊断次数、免费翻译字符串数）按运营策略调整
- [ ] 日志：进程级日志由 PM2/systemd 收集；建议加请求日志中间件（后续 Phase）

## 已知边界（MVP）

- 登录/账户系统为 Phase 4 预留（`user_id` 字段已建模，当前匿名设备隔离）
- 支付未接入；套餐定价（Free 100 条 / Starter $9 / Pro $19）为待验证假设
- 扫描为同步执行；超大站点建议后续改为队列 + 进度推送
- 邮件通知仅预留（线索入库后人工跟进）

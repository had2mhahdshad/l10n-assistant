# L10N ASSISTANT — AI SaaS Localization Assistant

面向中国 SaaS 出海开发者与独立开发者的本地化工具，包含两条**相互独立**的业务路径：

| 模块 | 类型 | 说明 |
|---|---|---|
| **Localization Checker** | 免费获客 | 输入网站 URL 或上传 JSON，检查翻译遗漏、语义偏差、术语不一致、变量损坏、UI 长度风险，生成 0–100 Localization Quality Score |
| **AI Translation** | 付费核心 | 上传 JSON → AI 批量翻译（日/德/法）→ 双语对照工作台 → 质量检查 → 开发者就绪导出（JSON / ZIP / CSV / QA 报告） |
| **Professional Human Translation** | 高客单增值 | 母语级专业译者翻译与修复服务，线索提交 + 后台管理（MVP 不做自动派单） |

两条路径不互相依赖：不做免费诊断也能直接用 AI 翻译，不做翻译也能完成免费诊断。任务、数据、额度分别管理，共享用户系统与 AI 服务。

## 技术栈

- **Node.js 22 + Express** — 服务端渲染 + JSON API，无构建步骤
- **SQLite（`node:sqlite` 内置模块）** — 零原生依赖，含迁移机制
- **Cheerio** — 静态 HTML 解析（不执行目标网站脚本）
- **Archiver** — ZIP 导出
- **AI 服务** — 服务端统一封装，支持任意 OpenAI 兼容端点；`AI_PROVIDER=mock` 时使用确定性离线引擎（开发/演示/测试无需 API Key）

## 快速开始

```bash
npm install
cp .env.example .env        # 按需修改
npm run migrate             # 初始化数据库（首次启动也会自动执行）
npm start                   # http://localhost:3000
npm test                    # 38 个单元 + 集成测试
```

> 启动脚本使用 `--experimental-sqlite`（Node 22 内置 SQLite 所需标志），已写入 `package.json`，无需手动添加。

## 页面地图

| 路径 | 说明 |
|---|---|
| `/` | Landing，两个独立入口（Check My Website / Translate JSON Files） |
| `/checker` | 免费诊断：Website Scan 与 JSON Content Audit 两个标签页 |
| `/report/:id` | 诊断报告：评分、维度、问题分布、真实示例（前 N 条完整展示）、专业译者 CTA |
| `/translate` | 创建翻译任务（粘贴/上传 JSON，上下文、术语、品牌词、忽略规则） |
| `/translate/jobs/:id` | 双语对照工作台：编辑、重译、审核、QA、导出 |
| `/professional` | 人工服务需求提交（可从报告页带审计上下文进入） |
| `/admin/leads` | 线索后台（需 `ADMIN_TOKEN`） |

## 设计原则（诚实性契约）

- 网站扫描只覆盖**抓取限额内公开可访问页面**，绝不宣称全站完整覆盖；报告始终展示扫描页数与覆盖说明
- UI 长度问题标记为**风险估算**，不宣称真实渲染验证
- 无法检测的维度显示 **Not Evaluated**，绝不默认满分
- 评分是辅助参考，不等同于专业人工审校结论
- 免费诊断展示真实问题（数量完整 + 部分完整示例），但不提供全部修复结果
- 不虚构译者资质，人工服务报价与交付由人工确认后才承诺

## 文档

- [docs/API.md](docs/API.md) — API 接口说明
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — 本地与生产部署
- [docs/PROMPTS.md](docs/PROMPTS.md) — AI Prompt 全文

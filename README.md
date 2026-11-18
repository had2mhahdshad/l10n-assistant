# L10N ASSISTANT — AI SaaS Localization Assistant

面向中国 SaaS 出海开发者与独立开发者的本地化工具，包含两条**相互独立**的业务路径：

| 模块 | 类型 | 说明 |
|---|---|---|
| **Localization Checker** | 免费获客 | 输入网站 URL 或上传 JSON，检查翻译遗漏、语义偏差、术语不一致、变量损坏、UI 长度风险，生成 0–100 Localization Quality Score |
| **AI Translation** | 付费核心 | 上传 JSON → AI 批量翻译（日/德/法）→ 双语对照工作台 → 质量检查 → 开发者就绪导出（JSON / ZIP / CSV / QA 报告） |
| **Professional Human Translation** | 高客单增值 | 母语级专业译者翻译与修复服务，线索提交 + 后台管理（MVP 不做自动派单） |

两条路径不互相依赖：不做免费诊断也能直接用 AI 翻译，不做翻译也能完成免费诊断。任务、数据、额度分别管理，共享用户系统与 AI 服务。

## 双语界面（EN / 中文）

界面默认跟随浏览器语言，可用顶部语言开关或 `?lang=zh` / `?lang=en` 强制切换，选择会写入 Cookie 记住。

- 字典集中在 `src/lib/i18n.js`（`DICT.en` / `DICT.zh`），服务端用 `T()` 渲染，客户端通过 `window.T` 复用同一份文案
- 中文模式下使用中文断行与字体栈，并关闭西文大写转换，避免中文被强制加字距
- API 错误文案同样走字典，不会在中文界面里冒英文报错

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
npm test                    # 80 个单元 + 集成测试
```

> 启动脚本使用 `--experimental-sqlite`（Node 22 内置 SQLite 所需标志），已写入 `package.json`，无需手动添加。

## 运行时配置（管理员）

免费检查**默认不设次数上限**（0 = 不限制）。如需限制或更换翻译模型，无需改代码或重启：

- 入口：`/admin/settings`，输入管理员令牌（`ADMIN_TOKEN`）后读写
- 可配置：翻译模型 API（provider / baseUrl / model / API Key / 温度 / 超时 / 重试）、评分维度权重与罚分规则、额度上限
- **API Key 只写不读**：接口永不回传明文，只有 `apiKeySet` 布尔值与末 4 位掩码；留空提交表示保留原值
- 「测试连接」会用当前配置真实调用一次 AI 服务；「预览评分」用固定样例（4 问题 / 100 样本）即时反映权重变化
- 详细字段见 `docs/API.md`

## 两个核心功能与商业化

**A. Localization Checker（免费诊断）** 与 **B. AI Translation（AI 翻译）** 相互独立、无前置依赖，两者都支持 **Website URL** 与 **JSON 文件** 两种输入。

Free + Paid 额度（全部后台可配，不硬编码）：

- URL 翻译：每任务最多 3 个公开页面（仅实际抓取的页面计入）
- JSON 翻译：每任务每语言最多 100 条可翻译字符串、20000 字符；英、日、德、法（及简中）均在免费额度内
- 超额**不拦截**：免费部分照常翻译、可完整下载；剩余内容保留原文，界面如实显示已用 / 剩余 / 未翻译数量，并提供解锁入口（本版本无在线支付，范围与报价由团队确认）
- 计费维度：URL 按页面与提取内容，JSON 按字符串数与字符量；多目标语言分别计量

## 多语言字体适配（可选，独立于 JSON 翻译）

- 按目标语言推荐字体（首发：英 / 日 / 德 / 法 / 简中），基于字符覆盖（如 ja = latin+kana+cjk）与授权校验
- 德语、法语明确建议沿用现有拉丁字体，不强制单独字体
- 生成独立 CSS 配置（`font-config-ja.css` 等）：系统字体回退 / `@font-face` 相对路径 / 在线字体服务合法引用；`font-display: swap`、WOFF2、`unicode-range` 子集化、不默认 preload、加载失败回退系统字体
- `localization-package/` 整合包：`locales/` + `fonts/`（仅授权允许时含字体文件，本阶段为授权说明）+ `styles/font-config.css` + `translation-manifest.json`
- 字体目录、授权、下载链接与层级价格（Free / Typography Pack / Professional Localization）全部数据驱动，后台可改

## 页面地图

| 路径 | 说明 |
|---|---|
| `/` | Landing，首屏内嵌免费检测（网站 URL / 上传 JSON 文件），附「如何获取全站文案 JSON」引导 |
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

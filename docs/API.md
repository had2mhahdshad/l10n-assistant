# API 接口说明

所有接口为 JSON（导出接口除外）。匿名用户通过 `l10n_anon` Cookie 标识设备，服务端自动签发。任务访问按 `user_id` / `anon_id` 隔离。

## Localization Checker（免费诊断模块）

### `POST /api/audit` — 网站诊断

```json
{
  "websiteUrl": "https://example.com",
  "targetUrl": "https://example.com/ja",       // 可选，缺省时尝试 hreflang / 语言切换器识别
  "sourceLanguage": "en",
  "targetLanguage": "ja"
}
```

- 支持语言：`en` `zh` `zh-CN` `ja` `de` `fr`
- 成功：`{ "id": "…", "status": "completed" }` → 打开 `/report/:id`
- 422：URL 不可扫描 / 无法识别目标语言版本（`needsTargetUrl: true`，不假设目标版本存在）
- 429：超出匿名每日 / 用户每月免费额度
- 扫描安全：仅 http/https、拒绝 localhost/内网/云元数据地址、每次重定向重新校验、超时与响应体大小限制、同域爬取深度与页数限制、不执行脚本

### `POST /api/audit/json` — JSON 完整内容审计

```json
{
  "sourceJson": { "a": "Save" },
  "targetJson": { "a": "保存" },              // 可选；提供后启用成对检查（准确性/术语/长度）
  "sourceLanguage": "en",
  "targetLanguage": "zh"
}
```

审计范围仅以上传文件为准，不代表验证了网站实际页面布局。

### `GET /api/audit/:id` — 获取诊断报告

返回：总分与五维分数（未检测维度 `score: null, evaluated: false`）、问题数量与严重度/类型分布、扫描页数与覆盖说明、前 N 条完整真实示例（`freeExamples`，N 由 `FREE_REPORT_FULL_EXAMPLES` 配置）、其余问题摘要（`summaries`）、付费边界说明（`paywallNote`）。**不返回全量修复翻译。**

**`nonTranslatable` — 不可翻译内容清单**（仅网站扫描模式，JSON 模式为 `null`）

文本翻译无法覆盖的内容单独统计，不混进问题列表、也不计入评分：

```json
{
  "images": 12,
  "imagesWithoutAlt": 4,
  "iframes": 2,
  "canvas": 1,
  "videos": 0,
  "svgs": 3,
  "noTranslateMarked": 1
}
```

含义与诚实边界：

| 字段 | 含义 | 为什么文本翻译覆盖不到 |
|---|---|---|
| `images` | 页面中的 `<img>` 数量 | 图片里的文字是像素，需要重新出图 |
| `imagesWithoutAlt` | 其中缺少 `alt` 的图片 | 连替代文本都没有，屏幕阅读器与翻译都拿不到内容 |
| `iframes` | 内嵌页面数量 | 独立文档，通常跨域，需按 frame 单独本地化 |
| `canvas` / `videos` | 画布与音视频数量 | 运行时绘制或媒体流，无 DOM 文本 |
| `svgs` | 内嵌 SVG 数量 | 矢量图形，文字可能已转为路径 |
| `noTranslateMarked` | `translate="no"` / `.notranslate` 数量 | 站点显式声明不翻译，尊重其意图 |

`websiteUrlRaw` 为原始 URL（`websiteUrl` 在 JSON 模式下是本地化文案），供前端渲染为可点击链接。

### 只读分享链接（两个模块通用）

每个诊断任务和翻译任务创建时都会生成 `share_token`。访问时可携带 `?t=<share_token>` 或请求头 `x-share-token`：

| 场景 | 结果 |
|---|---|
| 会话与任务归属匹配（owner） | 全权限，响应含 `shareToken` |
| 携带正确 `t=` / `x-share-token` | 只读：`access: "share"`，`readOnly: true`（翻译模块），响应**不含** `shareToken`（分享链接不能再分享） |
| 无会话、无 token，或 token 错误 | `403`，附带 `hint` 说明 |
| 用分享 token 调用写接口（编辑条目 / 执行翻译 / QA） | `403`，分享永不授予写权限 |

页面层：`/report/:id?t=<token>`、`/translate/jobs/:id?t=<token>`。分享视图会显示只读横幅，翻译工作台隐藏编辑与重译按钮、单元格置为 `readonly`，导出链接自动带上 token。


### `/api/admin/settings` — 运行时配置（仅管理员）

全部接口要求 `x-admin-token` 请求头（或 `?token=`），不匹配返回 `401`。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/admin/settings` | 当前配置。**API Key 永不回传**，只有 `apiKeySet` 布尔值与 `apiKeyHint` 掩码（`••••` + 末 4 位） |
| `GET` | `/api/admin/settings/meta` | 表单结构：维度键、问题类型键、环境变量默认值 |
| `PUT` | `/api/admin/settings` | 部分更新 `{ ai?, scoring?, quota? }`，非法值返回 `400`；`apiKey` 留空/`__KEEP__` 表示不改，`__CLEAR__` 表示清空 |
| `POST` | `/api/admin/settings/reset` | 恢复环境变量默认值 |
| `POST` | `/api/admin/settings/preview` | 用草稿评分规则对固定样例（4 问题 / 100 样本）计分，**不落库**，用于预览权重变化 |
| `POST` | `/api/admin/settings/test-ai` | 用当前配置真实调用一次 AI 服务，返回 `{ ok, provider, model, mock, latencyMs, error? }` |

配置修改**立即生效**（进程内缓存按数据库实例隔离），无需重启：

- `ai`：`provider`（mock/openai）、`baseUrl`、`model`、`apiKey`、`temperature`、`timeoutMs`、`maxRetries`
- `scoring`：五维权重（保存时自动归一化到 1）、严重度权重、罚分模型（`rateFactor`/`countUnit`/`absoluteCap`）、问题类型→维度映射
- `quota`：`anonAuditDaily` / `userAuditMonthly`（**0 = 不限制**，免费检查默认不限次）、`freeReportFullExamples`、`freeTranslateStrings`


## AI Translation（付费翻译模块）

### `POST /api/translate/jobs` — 创建翻译任务

```json
{
  "projectName": "My SaaS",
  "filename": "common.json",
  "sourceLanguage": "en",                     // en | zh | zh-CN
  "targetLanguages": ["ja", "de", "fr"],      // 至少一个
  "json": { "nav": { "home": "Home" } },
  "productType": "B2B analytics SaaS",
  "context": "…",
  "style": "product-neutral",
  "extra": "…",
  "brandTerms": ["Acme"],
  "glossary": [{ "sourceTerm": "workspace", "targetTerm": "ワークスペース", "locale": "ja" }],
  "ignoreKeys": ["^config\\."]
}
```

解析时保护：Key、嵌套层级、数组顺序、数据类型；占位符 `{name}` `{{name}}` `${name}` `%s` `%d` `:name`、HTML、Markdown、URL、代码片段均不翻译；`ignoreKeys` 为用户自定义忽略规则。返回 `stats`（含额度扣减预览），超额返回 429。

### `POST /api/translate/jobs/:id/run` — 执行翻译

`?locale=ja` 仅跑单语言；`?force=1` 连人工修改一并覆盖（默认保护 `manually_edited` 条目）。返回翻译数、失败数、Token 与成本统计。

### `GET /api/translate/jobs/:id` — 工作台数据

查询参数：`q`（Key 搜索）、`status`、`locale`、`issueType`（按问题类型筛选）。返回任务、项目、条目（含字符数/状态/人工标记）、质量检查结果。

### `PATCH /api/translate/entries/:id` — 人工编辑 / 状态流转

```json
{ "translatedText": "…", "status": "completed | needs_review | approved | skipped" }
```

修改文本后置 `manually_edited=1`，批量重译默认跳过。

### `POST /api/translate/entries/:id/retranslate` — 单条重译

人工修改过的条目返回 `409 requiresForce`；传 `{ "force": true }` 确认覆盖。

### `POST /api/translate/jobs/:id/qa` — 质量检查

检查项：JSON 结构完整性、Key 数量一致性、变量完整性、HTML 标签完整性、URL 变化、空翻译、重复翻译、术语表一致性、语言识别、UI 长度风险（估算）。结果存入 `quality_issues`，高/中严重度条目标记 `needs_review`。

### `GET /api/translate/jobs/:id/export` — 开发者导出

| `format` | 说明 |
|---|---|
| `json&locale=ja` | 单语言 JSON（导出前做结构校验，失败则 500 并附问题列表） |
| `zip` | `locales/<lang>/<file>.json` + `translations.csv` + `qa-report.md` |
| `csv` | 双语/多语对照表 |
| `report` | QA 报告（Markdown） |

## Professional Service（人工服务线索）

### `POST /api/leads` — 提交需求

```json
{
  "auditJobId": "…",                          // 可选，来自诊断报告时自动关联
  "email": "dev@example.com",
  "productName": "…",
  "targetLanguages": ["ja"],
  "serviceType": "Fix Translation Errors",    // 见 SERVICE_TYPES
  "estimatedWordCount": 3000,
  "description": "…",
  "needsHumanReview": true
}
```

关联诊断时自动快照：任务 ID、网站 URL、目标语言、Localization Score、问题数、已扫描页数。响应文案明确说明报价与交付需人工确认，不承诺译者已接单。

### `GET /api/admin/leads` / `PATCH /api/admin/leads/:id`

需请求头 `x-admin-token`（环境变量 `ADMIN_TOKEN`）。支持按状态筛选与状态流转（new → contacted → quoted → won/lost）。

## 其他

- `GET /api/health` — 存活检查（含当前 AI provider）

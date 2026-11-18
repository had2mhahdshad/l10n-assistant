# 测试与实际验证结果

> 所有结果来自本机实际执行（Node 22.13 / Chromium 144），非模拟结论。执行方式：`npm test`。

## 1. 自动化测试：44 项全部通过

```
# tests 44
# pass 44
# fail 0
```

| 测试文件 | 覆盖内容 | 用例数 |
|---|---|---|
| `tests/placeholder.test.js` | 占位符识别（`{name}`/`{{name}}`/`${name}`/`%s`/`%d`/`:name`/HTML/Markdown/URL）、mask→unmask 往返、丢失与新增检测、HTML 标签序列校验、URL 变更、自定义模式扩展 | 6 |
| `tests/jsonParser.test.js` | 递归解析、非字符串不翻译（数字/布尔/null/URL/资源路径）、用户忽略规则、结构重建（键序/层级/数组顺序/类型）、结构差异检测、统计 | 5 |
| `tests/scorer.test.js` | 无问题=100、按"问题率"计分公式、大站点不被少量绝对问题击穿、按维度采样、Not Evaluated 与权重重归一化、全维度未检测时不给满分、严重度单调性 | 7 |
| `tests/scanner.test.js` | 私网/回环/云元数据/CGNAT/组播地址拦截、非 http(s) 协议拒绝、localhost 与字面私网 IP 拒绝、域名解析到私网拒绝、公网 URL 放行、链接提取与同源判断 | 6 |
| `tests/extractor.test.js` | 可见文本提取、跳过 script/style、title/meta/placeholder 提取、`html lang` 与 hreflang/语言切换器解析、目标语言 URL 发现、无目标版本时返回 null（不猜测） | 4 |
| `tests/api.test.js` | 端到端 API：创建任务→执行翻译→结构/占位符/URL 保留→导出 JSON/ZIP/CSV→人工编辑保护→单条重译 force 语义→QA→JSON 审计→权限隔离→SSRF 拒绝→线索入库与后台→额度限流 | 16 |

关键行为断言（真实通过）：

- 6 条可翻译字符串 × 2 语言 → 实际完成 12 条，失败 0
- 导出 JSON 的键序、数字类型（`version: 2`）、URL 与源文件完全一致
- 人工编辑后执行批量重译：文本仍为 `手動修正テキスト`，`manuallyEdited=true`
- 单条重译对人工条目返回 `409 requiresForce`，`force=true` 才覆盖
- 他人设备 Cookie 访问审计报告 → `403`
- `http://169.254.169.254/...` → `private-ip` 拒绝
- 匿名设备第 5 次诊断（限额 4）→ `429`

## 2. 浏览器端到端验证（Chromium，真实点击）

脚本操作真实页面完成全链路，浏览器控制台 **无报错**：

| 步骤 | 结果 |
|---|---|
| JSON 审计标签页提交 → 跳转报告 | ✅ 评分/问题表/CTA 均渲染 |
| 报告页 CTA → 需求表单 → 提交 | ✅ 提示"Request received"，审计上下文自动关联 |
| 创建翻译任务（9 串 × ja/de） | ✅ 进入工作台 |
| 工作台"Translate All" | ✅ `18 translated, 0 failed · 839 tokens` |
| 运行 QA | ✅ `10 findings` |
| 手工编辑 → 批量重译 | ✅ 人工文本保留 |
| 后台线索页（token 鉴权） | ✅ 显示邮箱与审计上下文（score/issues/pages） |
| 移动端 390px | ✅ 无横向溢出 |

## 3. 真实公网站点验证

| 场景 | 结果 |
|---|---|
| `https://example.com`（无日语版本） | 正确提示"无法自动识别 ja 版本，请提供 URL 或改用 JSON 审计"，**未假设目标版本存在** |
| `http://169.254.169.254/latest/meta-data` | `blocked: private-ip` |
| `https://www.apple.com/` → `/jp/` | hreflang 自动发现成功；扫描 10 页 / 失败 0 / 文本样本 2934；评分 89（accuracy 82、naturalness 100、terminology 78、placeholders 99、uiLength 77）；问题 240：missing 18（其中 alt/title 类降级为 low）、terminology 76、ui length 145（标注为风险估算） |

## 4. 验证过程中发现并修复的真实缺陷

| # | 缺陷 | 修复 |
|---|---|---|
| 1 | `cheerio` 的 `.map()` 返回 Cheerio 对象而非数组，导致真实站点扫描抛 `join is not a function` | `.map(...).get().join(...)`，并新增 `extractor.test.js` 防止回归 |
| 2 | 按 DOM 顺序配对源/目标段落，产生 733 条错位 UI 长度"风险"（苹果站点） | 改为按 DOM 结构路径对齐；对不齐的页面直接不配对；无法对齐的维度显示 Not Evaluated |
| 3 | 绝对问题计数计分：18/2934 未翻译直接把准确度打到 0 分 | 改为按问题率计分（`rate×200 + min(15, 加权数×1.5)`），大站点小比例问题不再被击穿 |
| 4 | 工作台操作反馈在执行后重新渲染时丢失 | 消息状态提升为模块级变量，重渲染后保留 |
| 5 | 移动端顶栏导航与按钮溢出（390px 下 490px 宽） | 新增响应式断点，四页实测无溢出 |
| 6 | `:name` 占位符 token 丢失冒号前缀，校验时误判 | 正则分组修正为 `(:name)` |
| 7 | 报告页在 240 条问题时生成超长表格 | 摘要限定 30 条并标注"30 of N" |
| 8 | 报告与工作台只能由创建它的浏览器会话打开，无法交付给他人查看（预览链接必然 403） | 新增只读分享令牌：`?t=<share_token>` 可跨会话查看，且不授予写权限（编辑/执行/QA 仍 403）；分享视图不能再分享 |

## 5. 阶段状态

| Phase | 范围 | 状态 |
|---|---|---|
| 0 | 项目检查 | ✅ 工作区为空，从零搭建，技术方案见 README |
| 1 | AI Translation 核心（上传/解析/变量保护/翻译/双语工作台/QA/ZIP） | ✅ 已跑通并有测试 |
| 2 | 免费 Localization Checker（URL、扫描、语言发现、评分、免费报告） | ✅ 已跑通（真实站点验证） |
| 3 | 人工服务转化（CTA/表单/线索/后台） | ✅ 已跑通 |
| 4 | 商业化（登录、额度、成本、支付） | ⚠️ 部分：匿名配额、Token/成本统计已实现；登录与支付未实现 |
| 5 | SEO 页面 | ❌ 未实现（仅预留路由结构建议） |

## 6. 已知限制

- 网站扫描为同步执行，10 页上限下典型耗时 10–20 秒
- 跨语言段落对齐基于 DOM 结构路径；结构差异大的站点会把成对维度标为 Not Evaluated（这是刻意的诚实行为，不是缺陷）
- 站点级术语一致性仅覆盖对齐成功的段落；完整术语检查请使用 JSON 审计或 AI 翻译工作台
- `AI_PROVIDER=mock` 时输出为确定性占位译文（`［JA］…`），用于管线验证；接入真实模型需配置 `AI_API_KEY`
- 未接支付、未接邮件通知（仅入库，人工跟进）
- 分享链接为只读、不含有效期，当前不提供撤销入口（可由 owner 重新生成 token 实现吊销）

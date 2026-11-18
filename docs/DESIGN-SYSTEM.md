# Design System v2 — L10N ASSISTANT

Modern SaaS + Developer Tool。本文档是 `public/css/theme.css` 的规范说明；
所有类名向后兼容，业务代码不依赖具体颜色值。

## 1. 颜色体系

| 角色 | 变量 | 值 | 用途 |
|---|---|---|---|
| 页面底色 | `--canvas` | `#ffffff` | 页面背景 |
| 分区底色 | `--cream` | `#f7f8fa` | 导航悬停、表头、页脚 |
| 弱底色 | `--cream-deep` | `#f0f2f5` | 进度轨道、骨架条 |
| 主文字 | `--ink` | `#101828` | 标题、数字 |
| 正文 | `--text` | `#1d2939` | 正文 |
| 次要文字 | `--muted` | `#475467` | 说明文字 |
| 弱文字 | `--subtle` | `#98a2b3` | 提示、占位符 |
| **品牌强调** | `--brand` | `#2563eb` | 主按钮、链接、进度、选中态 |
| 品牌悬停 | `--brand-hover` | `#1d4ed8` | hover |
| 品牌浅底 | `--brand-soft` | `#eff4ff` | 选中标签、信息条 |
| 高风险 | `--danger` | `#d92d20` | 高严重度、错误 |
| 中风险 | `--warn` | `#dc6803` | 中严重度、警告 |
| 低风险/通过 | `--success` | `#12b76a` | 低严重度、成功 |

约束：全站只有一个品牌强调色；大面积紫色渐变与"AI 科技感"装饰一律不用；
渐变仅允许 Hero 顶部一层 ≤7% 透明度的径向光晕。

## 2. 字体与排版

- 正文/标题：`Inter, system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC"`（现代无衬线，中文自动回退）
- 等宽：`SFMono-Regular / JetBrains Mono / Menlo`，仅用于键名、代码、占位符、数值
- 字号阶梯：`34–60px` H1 · `22–28px` H2 · `16–17px` H3 · `15px` 正文 · `13.5px` 次级 · `12–12.5px` 标注 · `11–11.5px` 徽章
- 标题字重 700–800，`letter-spacing: -.02em ~ -.035em`（中文收窄为 -.02em）
- 中文界面关闭全部西文 `text-transform: uppercase`（见 `html[lang="zh-CN"]` 覆盖）
- 行高：正文 1.65–1.75

## 3. 形状与深度

- 圆角：`6px`（输入框/按钮）· `10px`（ notices/表格容器）· `14px`（卡片）· `999px`（徽章）
- 边框：`1px solid #e4e7ec`；分隔线 `#eaecf0`
- 阴影三级：`--shadow-xs`（静止）· `--shadow-md`（hover）· `--shadow-lg`（浮层/预览卡）
- 聚焦环：`0 0 0 3px rgba(37,99,235,.16)`（所有输入框与按钮 `:focus-visible`）

## 4. 基础组件

| 组件 | 类名 | 规范 |
|---|---|---|
| 主按钮 | `.btn.primary` | 靛蓝填充，hover 加深 + 上浮 1px |
| 次按钮 | `.btn` | 白底描边，hover 浅灰底 |
| 文字按钮 | `.btn.ghost` | 无边框，hover 浅灰底 |
| 小按钮 | `.btn.sm` | 34px 高，用于表格/卡片内动作 |
| 徽章 | `.badge.green/blue/yellow/red/ink` | 胶囊形、浅底深字 |
| 严重度 | `.sev.high/medium/low` + `.sev-dot` | 色 点 + 浅底，全站统一语义 |
| 卡片 | `.entry-card / .feature / .form-panel / .issue / .stat-card` | 白底 1px 边框 14px 圆角，hover 阴影加深 |
| 表格 | `.tbl`（容器 `.tbl-wrap`） | 表头浅灰大写小字，行 hover，圆角裁切 |
| 表单 | `.field input/select/textarea` | 6px 圆角，聚焦品牌环 |
| 提示条 | `.notice.info/warn/error/ok` | 左侧 3px 语义色条 |
| 分区头 | `.section-head` | 编号胶囊 + 标题 + 细线 |
| 环形评分 | `.score-ring` | SVG `stroke-dashoffset` 动画 1s；颜色随分数段切换 |
| 问题卡 | `.issue.sev-high/medium/low` | 左侧 3px 严重度色条 + 分栏对照 + `<mark>` 高亮 |

## 5. 动效

- 时长 `.16s`（交互）/ `.2s`（卡片）/ `1s`（评分环与进度条，缓动 `cubic-bezier(.22,1,.36,1)`）
- hover 只做：背景/边框/透明度变化、阴影加深、位移 ≤2px
- 加载态：`.spinner` 旋转 + `.progress-line` 进度
- `prefers-reduced-motion` 下全部动画关闭

## 6. 布局与响应式

- 内容宽度 `min(1180px, 100% - 48px)`；Hero 区左右两栏（`960px` 断点以下堆叠）
- 断点：`960px`（导航折叠）/ `820px`（入口卡两列）/ `720px`（能力三列）/ `700px`（问题对照分栏）/ `640px` / `520px`
- 移动端要求：无横向溢出、触控目标 ≥34px、统计卡两列、评分环 150px

## 7. 内容规范（与视觉同等重要）

- 评分、问题数、样本数只来自真实检测结果；首页预览卡只展示界面结构，数值一律 `—` 并明确标注"不含虚构数据"
- 覆盖范围、AI 可用性、免费/付费边界必须在界面上如实陈述
- 免费诊断与付费翻译是两条独立业务线，任何入口不得合并或伪装

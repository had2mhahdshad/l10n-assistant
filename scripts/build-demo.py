#!/usr/bin/env python3
"""Build the static demo site published to GitHub Pages.

Copies the captured screenshots into demo/shots/ and writes a single
self-contained gallery page (relative image paths, no inline base64).
"""
import os
import shutil
from PIL import Image

SRC = '/workspace/l10n-assistant/screenshots'
DEMO = '/workspace/l10n-assistant/demo'
SHOTS = os.path.join(DEMO, 'shots')

GROUPS = [
    ('English', 'en', [
        ('01-landing.png', 'Landing Page', 'Two independent entries: free Localization Checker and paid AI Translation. Paper texture, ink rules, square corners, monospace labels.'),
        ('02-checker.png', 'Localization Checker', 'URL scan / JSON audit tabs, language pickers, crawl-limit notice.'),
        ('03-report.png', 'Diagnostic Report', 'Score 84/100, five weighted dimensions, issue distribution, 3 real examples in full, remaining issues summarised.'),
        ('04-workspace.png', 'Translation Workspace', '33 strings x JA/DE/FR, bilingual rows, QA flags per row, export toolbar.'),
        ('05-translate-new.png', 'AI Translation Upload', 'JSON upload / paste, target languages, product context, glossary, brand terms.'),
        ('06-professional.png', 'Professional Service', 'Lead capture form carrying audit context (score, issue count, scanned pages).'),
    ]),
    ('中文', 'zh', [
        ('zh-01-landing.png', '中文首页', '双入口：免费本地化检测 + 付费 AI 翻译。纸质底、墨色描边、全直角、等宽标签。'),
        ('zh-02-checker.png', '本地化检测', '网站扫描 / JSON 内容审计两个标签页，语言选择，抓取限额提示。'),
        ('zh-03-report.png', '本地化诊断报告', '总分 84/100，五维加权评分，问题分布，3 条真实示例完整展示，其余摘要。'),
        ('zh-04-workspace.png', '翻译工作台', '33 条 × 日/德/法，双语对照行，逐行 QA 标记，导出工具条。'),
        ('zh-05-translate.png', 'AI 翻译上传', 'JSON 上传/粘贴、目标语言、产品背景、术语与品牌词。'),
        ('zh-06-professional.png', '专业人工服务', '需求表单，自动携带诊断上下文（评分、问题数、已扫描页数）。'),
    ]),
]

MOBILE = [
    ('07-mobile.png', 'Mobile — 390px', 'Responsive layout: stacked header, single-column entries.'),
    ('zh-07-mobile.png', '移动端 — 390px', '窄屏堆叠：单列入口卡片，导航折行。'),
]


def main():
    os.makedirs(SHOTS, exist_ok=True)
    sections = []

    def add(num, file, title, desc):
        src = os.path.join(SRC, file)
        if not os.path.exists(src):
            return ''
        dst = os.path.join(SHOTS, file.replace('.png', '.jpg'))
        im = Image.open(src).convert('RGB')
        if im.width > 1440:
            im = im.resize((1440, int(im.height * 1440 / im.width)), Image.LANCZOS)
        im.save(dst, 'JPEG', quality=80, optimize=True)
        size = os.path.getsize(dst) / 1024
        return (
            f'<section id="p{num}"><div class="cap"><span class="no">{num:02d}</span>'
            f'<h2>{title}</h2><span class="meta">{size:.0f} KB</span></div>'
            f'<p class="desc">{desc}</p>'
            f'<img src="shots/{os.path.basename(dst)}" alt="{title}" loading="lazy" /></section>'
        )

    n = 0
    nav = []
    for label, _code, items in GROUPS:
        nav.append(f'<span class="grp">{label}</span>')
        for file, title, desc in items:
            n += 1
            html = add(n, file, title, desc)
            if html:
                sections.append(html)
                nav.append(f'<a href="#p{n}">{n:02d} {title}</a>')
    for file, title, desc in MOBILE:
        n += 1
        html = add(n, file, title, desc)
        if html:
            sections.append(html)
            nav.append(f'<a href="#p{n}">{"📱"} {title}</a>')

    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>L10N Assistant — Design Review (EN / 中文)</title>
<meta name="description" content="Screenshots of the AI SaaS Localization Assistant: free localization checker, quality score report and AI translation workspace. English and Chinese UI." />
<style>
  :root {{ --paper:#efede4; --ink:#2d2e2a; --muted:#6b6a63; --rule:#c9c6b8; --blue:#c9d8e4; --pink:#e8cfd1; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; background:var(--paper); color:var(--ink); font-family:ui-monospace,"SF Mono",Menlo,Consolas,"PingFang SC","Microsoft YaHei",monospace; font-size:13px; line-height:1.6; }}
  header {{ position:sticky; top:0; z-index:9; background:var(--paper); border-bottom:1px solid var(--ink); padding:10px 20px; display:flex; gap:14px; align-items:baseline; flex-wrap:wrap; }}
  header b {{ font-size:14px; letter-spacing:.06em; }}
  header .sub {{ color:var(--muted); font-size:10px; text-transform:uppercase; letter-spacing:.12em; }}
  nav {{ display:flex; gap:0; flex-wrap:wrap; margin-left:auto; align-items:center; }}
  nav .grp {{ font-size:9px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); padding:0 8px; border-left:1px solid var(--rule); }}
  nav a {{ color:var(--ink); text-decoration:none; font-size:10px; letter-spacing:.04em; padding:4px 8px; border:1px solid var(--rule); margin-left:-1px; }}
  nav a:hover {{ background:var(--blue); }}
  main {{ max-width:1520px; margin:0 auto; padding:24px 20px 60px; }}
  section {{ margin-bottom:36px; border:1px solid var(--ink); background:#f5f3ec; }}
  .cap {{ display:flex; align-items:baseline; gap:10px; padding:10px 14px; border-bottom:1px solid var(--ink); }}
  .no {{ font-size:10px; background:var(--ink); color:var(--paper); padding:1px 6px; }}
  .cap h2 {{ margin:0; font-size:15px; letter-spacing:.03em; }}
  .meta {{ margin-left:auto; font-size:10px; color:var(--muted); }}
  .desc {{ margin:0; padding:10px 14px; font-size:11px; color:var(--muted); border-bottom:1px solid var(--rule); }}
  img {{ display:block; width:100%; height:auto; }}
  .intro {{ border:1px solid var(--ink); padding:16px 18px; margin-bottom:28px; background:#f5f3ec; }}
  .intro h1 {{ margin:0 0 8px; font-size:22px; letter-spacing:.02em; }}
  .intro p {{ margin:0 0 6px; color:var(--muted); font-size:12px; }}
  .intro .note {{ border-top:1px solid var(--rule); margin-top:12px; padding-top:10px; font-size:11px; background:none; }}
  code {{ background:#e4e1d7; padding:1px 4px; }}
  footer {{ border-top:1px solid var(--ink); padding:14px 20px; font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.1em; }}
  @media (max-width:720px) {{ header {{ gap:8px; }} nav {{ margin-left:0; }} .intro h1 {{ font-size:18px; }} }}
</style>
</head>
<body>
<header>
  <b>L10N ASSISTANT</b>
  <span class="sub">design review · EN / 中文 · paper #efede4</span>
  <nav>{''.join(nav)}</nav>
</header>
<main>
  <div class="intro">
    <h1>AI SaaS Localization Assistant</h1>
    <p>Free localization quality checker + AI JSON translation workbench + professional human translation lead capture. Two independent products, one account system.</p>
    <p>免费本地化质量检测 + AI JSON 翻译工作台 + 母语级人工翻译需求承接。两条业务线彼此独立，共用一套账号与 AI 服务。</p>
    <div class="note">
      These are real screenshots captured from the running app (Node 22 / Express / SQLite, 46 automated tests).
      The interactive app is a Node service and cannot run on GitHub Pages — this page is the static design review.
      Translations shown with ［DE］／［FR］ prefixes are mock-engine output: the app runs offline until a model key is configured.
    </div>
  </div>
  {''.join(sections)}
</main>
<footer>L10N ASSISTANT — archive of global shipping · {n} captures</footer>
</body>
</html>
"""
    with open(os.path.join(DEMO, 'index.html'), 'w', encoding='utf-8') as fh:
        fh.write(page)
    print('demo/index.html written,', n, 'captures,',
          round(sum(os.path.getsize(os.path.join(SHOTS, f)) for f in os.listdir(SHOTS)) / 1024 / 1024, 1), 'MB of images')


if __name__ == '__main__':
    main()

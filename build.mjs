// 整理手記 — 靜態網站建置腳本
//
// 用法：node build.mjs
//
// 讀 posts/*.md，輸出 dist/。首頁與各遊戲頁的文章卡片是「建置時就寫進 HTML」的，
// 不是前端用 JS 讀 JSON 生出來的 —— 這是刻意的 SEO 選擇。
//
// 每篇文章的「最後更新」取自 .md 檔的 mtime，所以改完檔案重跑就會自動更新，
// 卡片也會依最後更新時間重新排序（新的在前）。
//
// 一個站可以放多款遊戲：site.config.json 的 games[] 定義每款遊戲的頁面、
// HERO 圖與主色；文章用 frontmatter 的 `game:` 指定歸屬，沒寫就歸到 defaultGame。
//
// 網址規劃：
//   /                  站台首頁（遊戲索引 + 最新文章）
//   /<gameId>/         單一遊戲的專頁（介紹 + 該遊戲全部文章）
//   /<YYYYMMDD-slug>/  文章頁（維持扁平網址，改站台結構也不會弄壞舊連結）

import { readFile, writeFile, readdir, mkdir, stat, rm, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const POSTS_DIR = path.join(ROOT, 'posts')
const STATIC_DIR = path.join(ROOT, 'static')
const DIST = path.join(ROOT, 'dist')

// ---------------------------------------------------------------- 小工具

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const escAttr = (s = '') => esc(s).replace(/'/g, '&#39;')

/** Date -> "2026-08-02" (以本地時間為準) */
function ymd (d) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** "20260802-introduction" -> Date(2026-08-02)，取不到就回 null */
function dateFromSlug (slug) {
  const m = /^(\d{4})(\d{2})(\d{2})-/.exec(slug)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

// ---------------------------------------------------------------- frontmatter

/** 解析檔頭的 `--- key: value ---` 區塊，回傳 { data, body } */
function parseFrontmatter (raw) {
  const text = raw.replace(/^﻿/, '')
  if (!text.startsWith('---')) return { data: {}, body: text }

  const end = text.indexOf('\n---', 3)
  if (end === -1) return { data: {}, body: text }

  const head = text.slice(3, end)
  const body = text.slice(end + 4).replace(/^\r?\n/, '')
  const data = {}

  for (const line of head.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf(':')
    if (i === -1) continue

    const key = trimmed.slice(0, i).trim()
    let value = trimmed.slice(i + 1).trim()

    // 去掉包住整個值的引號
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    // [a, b, c] 當成陣列
    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    } else {
      data[key] = value
    }
  }

  return { data, body }
}

// ---------------------------------------------------------------- markdown

/** 行內語法：粗體、斜體、行內程式碼、連結、圖片 */
function inline (s) {
  const codes = []
  // 先把 `code` 抽出來存起來，避免裡面的符號被後面的規則吃掉
  let out = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c)
    return ` CODE${codes.length - 1} `
  })

  out = esc(out)

  // ![alt](src)
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_, alt, src, title) =>
    `<img src="${escAttr(src)}" alt="${escAttr(alt)}"${title ? ` title="${escAttr(title)}"` : ''} loading="lazy" decoding="async">`
  )

  // [text](href)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    const external = /^https?:\/\//i.test(href)
    const rel = external ? ' target="_blank" rel="noopener noreferrer"' : ''
    return `<a href="${escAttr(href)}"${rel}>${text}</a>`
  })

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')

  return out.replace(/ CODE(\d+) /g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`)
}

/** 夠用就好的 markdown 子集：標題、段落、清單、引言、分隔線、程式碼區塊、表格 */
function markdown (src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const html = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 空行
    if (!line.trim()) { i++; continue }

    // ``` 程式碼區塊
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim()
      const buf = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) buf.push(lines[i++])
      i++ // 收掉結尾的 ```
      html.push(
        `<pre><code${lang ? ` class="language-${escAttr(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre>`
      )
      continue
    }

    // --- 分隔線
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { html.push('<hr>'); i++; continue }

    // # 標題
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1].length
      html.push(`<h${level}>${inline(h[2].trim())}</h${level}>`)
      i++
      continue
    }

    // > 引言
    if (/^\s*>\s?/.test(line)) {
      const buf = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''))
      html.push(`<blockquote>${markdown(buf.join('\n'))}</blockquote>`)
      continue
    }

    // | 表格 |
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const head = cells(lines[i])
      i += 2
      const body = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(cells(lines[i++]))
      html.push(
        '<div class="table-scroll"><table><thead><tr>' +
        head.map(c => `<th>${inline(c)}</th>`).join('') +
        '</tr></thead><tbody>' +
        body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
        '</tbody></table></div>'
      )
      continue
    }

    // - 項目清單 / 1. 編號清單
    const bullet = /^\s*[-*+]\s+/
    const ordered = /^\s*\d+\.\s+/
    if (bullet.test(line) || ordered.test(line)) {
      const isOrdered = ordered.test(line)
      const re = isOrdered ? ordered : bullet
      const items = []
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ''))
      const tag = isOrdered ? 'ol' : 'ul'
      html.push(`<${tag}>${items.map(t => `<li>${inline(t)}</li>`).join('')}</${tag}>`)
      continue
    }

    // 其餘視為段落，連續行併成一段
    const buf = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|\s*>|\s*[-*+]\s|\s*\d+\.\s|```)/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) buf.push(lines[i++])
    html.push(`<p>${inline(buf.join(' '))}</p>`)
  }

  return html.join('\n')
}

// ---------------------------------------------------------------- 讀文章

async function loadPosts (cfg, gameById) {
  if (!existsSync(POSTS_DIR)) return []

  const files = (await readdir(POSTS_DIR)).filter(f => f.endsWith('.md'))
  const posts = []

  for (const file of files) {
    const full = path.join(POSTS_DIR, file)
    const raw = await readFile(full, 'utf8')
    const { data, body } = parseFrontmatter(raw)
    const slug = file.replace(/\.md$/, '')

    if (data.draft === 'true') continue

    // 歸屬遊戲：frontmatter 沒寫就用 defaultGame；寫錯直接報錯，免得默默歸錯地方
    const gameId = data.game || cfg.defaultGame
    if (!gameById.has(gameId)) {
      throw new Error(`posts/${file}：game "${gameId}" 不在 site.config.json 的 games[] 裡`)
    }

    // 發布日：frontmatter 優先，其次從檔名推，再不然用檔案 mtime
    const st = await stat(full)
    const published = data.date ? new Date(data.date) : (dateFromSlug(slug) ?? st.mtime)

    // 最後更新：一律用檔案 mtime —— 改了檔案重新建置就會自動換日期
    const updated = st.mtime

    posts.push({
      slug,
      gameId,
      title: data.title || slug,
      summary: data.summary || '',
      author: data.author || '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      published,
      updated,
      publishedYmd: ymd(published),
      updatedYmd: ymd(updated),
      html: markdown(body)
    })
  }

  // 最新更新的在前；同時間就用發布日再比一次
  posts.sort((a, b) => (b.updated - a.updated) || (b.published - a.published))
  return posts
}

// ---------------------------------------------------------------- 版型

/**
 * 每款遊戲一組主色，用 data-game 掛在 <html>（遊戲頁、文章頁）或卡片上（首頁）。
 * 直接內嵌進 <head>，省一次額外請求 —— 內容很短，不值得為它多開一個檔案。
 */
function gameStyles (cfg) {
  const light = []
  const dark = []

  for (const g of cfg.games) {
    const a = g.accent || {}
    if (!a.light) continue
    light.push(`[data-game="${g.id}"]{--accent:${a.light};--accent-soft:${a.lightSoft || a.light}}`)
    if (a.dark) dark.push(`[data-game="${g.id}"]{--accent:${a.dark};--accent-soft:${a.darkSoft || a.dark}}`)
  }

  if (!light.length) return ''
  return `\n<style>${light.join('')}${
    dark.length ? `@media(prefers-color-scheme:dark){${dark.join('')}}` : ''
  }</style>`
}

function head (cfg, { title, description, canonical, depth, game, ogType }) {
  const base = depth ? '../' : ''
  const ogImage = cfg.baseUrl && game
    ? `${cfg.baseUrl.replace(/\/$/, '')}/${game.hero.file}`
    : ''

  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${escAttr(description)}">
<meta name="color-scheme" content="light dark">
<meta property="og:type" content="${escAttr(ogType || 'website')}">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(description)}">
<meta property="og:site_name" content="${escAttr(cfg.title)}">${
  ogImage ? `\n<meta property="og:image" content="${escAttr(ogImage)}">` : ''
}${
  canonical ? `\n<link rel="canonical" href="${escAttr(canonical)}">` : ''
}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%93%9A%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="${base}assets/styles.css">${gameStyles(cfg)}
<script src="${base}assets/config.js"></script>
<script src="${base}assets/counter.js" defer></script>`
}

/** 站台導覽列 —— 每一頁都有，目前所在的那一項標 aria-current */
function navBlock (cfg, depth, currentId) {
  const base = depth ? '../' : ''
  const items = [
    `<a href="${base || './'}"${currentId === '__home__' ? ' aria-current="page"' : ''}>首頁</a>`,
    ...cfg.games.map(g =>
      `<a href="${base}${escAttr(g.id)}/" data-game="${escAttr(g.id)}"${
        currentId === g.id ? ' aria-current="page"' : ''
      }>${esc(g.emoji || '')} ${esc(g.name)}</a>`
    )
  ]
  return `<nav class="site-nav" aria-label="站台導覽">
  <div class="wrap">${items.join('')}</div>
</nav>`
}

function heroBlock (game, depth) {
  const base = depth ? '../' : ''
  const h = game.hero
  return `<figure class="hero">
    <img src="${base}${escAttr(h.file)}" alt="${escAttr(h.alt)}" width="${h.width || 1920}" height="${h.height || 1080}" fetchpriority="high" decoding="async">
  </figure>`
}

/** HERO 圖出處：外部授權圖列完整標示，自製圖只標一行 */
function creditLine (game) {
  const c = game.hero.credit
  if (c) {
    return `<p class="credit">
      《${esc(game.name)}》HERO 圖片：<a href="${escAttr(c.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(c.title)}</a>
      ／作者 <a href="${escAttr(c.authorUrl)}" target="_blank" rel="noopener noreferrer">${esc(c.author)}</a>
      ／授權 <a href="${escAttr(c.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(c.license)}</a>${
        c.source ? `／來源 ${esc(c.source)}` : ''
      }。圖片未經修改，僅縮放尺寸。
    </p>`
  }
  if (game.hero.note) return `<p class="credit">《${esc(game.name)}》${esc(game.hero.note)}</p>`
  return ''
}

function footerBlock (cfg, depth, games) {
  const base = depth ? '../' : ''
  return `<footer class="site-footer">
    ${games.map(creditLine).filter(Boolean).join('\n    ')}
    ${games.map(g => `<p class="disclaimer">${esc(g.disclaimer)}</p>`).join('\n    ')}
    <p class="copyright">© ${new Date().getFullYear()} ${esc(cfg.title)}　·　<a href="${base || './'}">回首頁</a></p>
  </footer>`
}

function page (cfg, { title, description, canonical, depth, game, ogType, body }) {
  return `<!doctype html>
<html lang="${escAttr(cfg.lang)}"${game ? ` data-game="${escAttr(game.id)}"` : ''}>
<head>
${head(cfg, { title, description, canonical, depth, game, ogType })}
</head>
<body>
<a class="skip-link" href="#main">跳到主要內容</a>
${body}
</body>
</html>
`
}

// ---------------------------------------------------------------- 文章卡片

/**
 * 首頁與遊戲頁共用的一張文章卡片。
 * 這些卡片是建置時就產生好的 HTML，不是前端 JS 讀 JSON 畫出來的。
 */
function postCard (cfg, post, { depth, game }) {
  const base = depth ? '../' : ''
  return `      <li>
        <article class="card"${game ? ` data-game="${escAttr(post.gameId)}"` : ''}>${
          game
            ? `\n          <p class="card-game"><a href="${base}${escAttr(game.id)}/">${esc(game.emoji || '')} ${esc(game.title)}</a></p>`
            : ''
        }
          <h3><a href="${base}${escAttr(post.slug)}/">${esc(post.title)}</a></h3>
          <p class="card-summary">${esc(post.summary)}</p>
          <p class="card-meta">
            <span class="meta-item">✍️ ${esc(post.author || cfg.author)}</span>
            <span class="meta-item"><time datetime="${post.publishedYmd}">發布 ${post.publishedYmd}</time></span>
            <span class="meta-item"><time datetime="${post.updatedYmd}">更新 ${post.updatedYmd}</time></span>
            <span class="meta-item views">👁 <span class="view-count" data-views="${escAttr(post.slug)}">—</span></span>
          </p>${
            post.tags.length
              ? `\n          <p class="tags">${post.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</p>`
              : ''
          }
        </article>
      </li>`
}

// ---------------------------------------------------------------- 站台首頁

function renderHome (cfg, posts, gameById) {
  const gameCards = cfg.games.map(g => {
    const n = posts.filter(p => p.gameId === g.id).length
    return `      <li>
        <article class="card game-card" data-game="${escAttr(g.id)}">
          <a class="game-thumb" href="${escAttr(g.id)}/" tabindex="-1" aria-hidden="true">
            <img src="${escAttr(g.hero.file)}" alt="" width="${g.hero.width || 1920}" height="${g.hero.height || 1080}" loading="lazy" decoding="async">
          </a>
          <h3><a href="${escAttr(g.id)}/">${esc(g.emoji || '')} ${esc(g.title)}</a></h3>
          <p class="card-summary">${esc(g.tagline)}</p>
          <p class="card-meta">
            <span class="meta-item">📝 ${n} 篇文章</span>
            <span class="meta-item views">👁 <span class="view-count" data-views="${escAttr(g.id)}">—</span></span>
          </p>
        </article>
      </li>`
  }).join('\n')

  const cards = posts.map(p =>
    postCard(cfg, p, { depth: false, game: gameById.get(p.gameId) })
  ).join('\n')

  const body = `<header class="site-header">
  <div class="wrap">
    <h1 class="site-title">${esc(cfg.title)}</h1>
    <p class="site-tagline">${esc(cfg.tagline)}</p>
    <p class="site-stats">本站總瀏覽 <span class="view-count" data-views="__home__" data-primary>—</span> 次</p>
  </div>
</header>

${navBlock(cfg, false, '__home__')}

<main id="main" class="wrap">
  <section class="intro">
    <h2>關於這裡</h2>
    <p>${esc(cfg.description)}</p>
  </section>

  <section class="game-list">
    <h2>收錄的遊戲<span class="count">（${cfg.games.length} 款）</span></h2>
    <ul class="game-grid">
${gameCards}
    </ul>
  </section>

  <section class="post-list">
    <h2>最新文章<span class="count">（${posts.length} 篇）</span></h2>
    <ul class="cards">
${cards || '      <li><p class="empty">還沒有文章。</p></li>'}
    </ul>
  </section>

  ${footerBlock(cfg, false, cfg.games)}
</main>`

  return page(cfg, {
    title: `${cfg.title}｜${cfg.tagline}`,
    description: cfg.description,
    canonical: cfg.baseUrl || undefined,
    depth: false,
    ogType: 'website',
    body
  })
}

// ---------------------------------------------------------------- 遊戲專頁

function renderGame (cfg, game, posts) {
  const mine = posts.filter(p => p.gameId === game.id)
  const cards = mine.map(p => postCard(cfg, p, { depth: true, game: null })).join('\n')

  const facts = (game.facts || []).length
    ? `<div class="table-scroll"><table class="facts"><tbody>${
        game.facts.map(f => `<tr><th scope="row">${esc(f.label)}</th><td>${esc(f.value)}</td></tr>`).join('')
      }</tbody></table></div>`
    : ''

  const store = game.storeUrl
    ? `<p class="store-link"><a href="${escAttr(game.storeUrl)}" target="_blank" rel="noopener noreferrer">在 Steam 上查看《${esc(game.name)}》→</a></p>`
    : ''

  const body = `<header class="site-header compact">
  <div class="wrap">
    <p class="breadcrumb"><a href="../">${esc(cfg.title)}</a> <span aria-hidden="true">›</span> ${esc(game.title)}</p>
  </div>
</header>

${navBlock(cfg, true, game.id)}

<main id="main" class="wrap">
  <div class="game-head">
    <h1>${esc(game.emoji || '')} ${esc(game.title)}</h1>
    <p class="site-tagline">${esc(game.tagline)}</p>
    <p class="card-meta">
      <span class="meta-item">📝 ${mine.length} 篇文章</span>
      <span class="meta-item views">👁 <span class="view-count" data-views="${escAttr(game.id)}" data-primary>—</span> 次瀏覽</span>
    </p>
  </div>

  ${heroBlock(game, true)}

  <section class="intro">
    <h2>關於這款遊戲</h2>
    <p>${esc(game.description)}</p>
    ${facts}
    ${store}
  </section>

  <section class="post-list">
    <h2>全部文章<span class="count">（${mine.length} 篇）</span></h2>
    <ul class="cards">
${cards || '      <li><p class="empty">還沒有文章。</p></li>'}
    </ul>
  </section>

  ${footerBlock(cfg, true, [game])}
</main>`

  return page(cfg, {
    title: `${game.title}｜${cfg.title}`,
    description: game.description,
    canonical: cfg.baseUrl ? `${cfg.baseUrl.replace(/\/$/, '')}/${game.id}/` : undefined,
    depth: true,
    game,
    ogType: 'website',
    body
  })
}

// ---------------------------------------------------------------- 文章頁

function renderPost (cfg, post, game) {
  const body = `<header class="site-header compact">
  <div class="wrap">
    <p class="breadcrumb"><a href="../">${esc(cfg.title)}</a> <span aria-hidden="true">›</span> <a href="../${escAttr(game.id)}/">${esc(game.title)}</a></p>
  </div>
</header>

${navBlock(cfg, true, game.id)}

<main id="main" class="wrap">
  <article class="post">
    <h1>${esc(post.title)}</h1>

    <p class="post-meta">
      <span class="meta-item">✍️ 作者：${esc(post.author || cfg.author)}</span>
      <span class="meta-item"><time datetime="${post.publishedYmd}">發布 ${post.publishedYmd}</time></span>
      <span class="meta-item"><time datetime="${post.updatedYmd}">最後更新 ${post.updatedYmd}</time></span>
      <span class="meta-item views">👁 <span class="view-count" data-views="${escAttr(post.slug)}" data-primary>—</span> 次瀏覽</span>
    </p>${
      post.tags.length
        ? `\n\n    <p class="tags">${post.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</p>`
        : ''
    }

    ${heroBlock(game, true)}

    <div class="post-body">
${post.html}
    </div>
  </article>

  <nav class="post-nav"><a href="../${escAttr(game.id)}/">← 回${esc(game.title)}</a>　·　<a href="../">回首頁</a></nav>

  ${footerBlock(cfg, true, [game])}
</main>`

  return page(cfg, {
    title: `${post.title}｜${game.title}`,
    description: post.summary || game.description,
    canonical: cfg.baseUrl ? `${cfg.baseUrl.replace(/\/$/, '')}/${post.slug}/` : undefined,
    depth: true,
    game,
    ogType: 'article',
    body
  })
}

// ---------------------------------------------------------------- 其他輸出

function renderConfigJs (cfg, posts) {
  return `// 建置時自動產生，請勿手改。
window.SITE_CONFIG = ${JSON.stringify({
    supabaseUrl: cfg.supabase.url || '',
    supabaseAnonKey: cfg.supabase.anonKey || '',
    slugs: ['__home__', ...cfg.games.map(g => g.id), ...posts.map(p => p.slug)]
  }, null, 2)};
`
}

function renderSitemap (cfg, posts) {
  const base = (cfg.baseUrl || '').replace(/\/$/, '')
  if (!base) return null

  const latestOf = list => (list[0] ? list[0].updatedYmd : ymd(new Date()))

  const urls = [
    `  <url><loc>${base}/</loc><lastmod>${latestOf(posts)}</lastmod></url>`,
    ...cfg.games.map(g =>
      `  <url><loc>${base}/${g.id}/</loc><lastmod>${latestOf(posts.filter(p => p.gameId === g.id))}</lastmod></url>`
    ),
    ...posts.map(p => `  <url><loc>${base}/${p.slug}/</loc><lastmod>${p.updatedYmd}</lastmod></url>`)
  ]

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`
}

/**
 * 404 頁。
 *
 * 沒有這個檔案時，Cloudflare Pages 會把找不到的路徑 fallback 成首頁並回 200，
 * Google 會判定為 soft 404。有了它才會回真正的 404 狀態碼。
 */
function render404 (cfg) {
  const body = `${navBlock(cfg, false, null)}

<main id="main" class="wrap">
  <section class="intro">
    <h1>找不到這個頁面</h1>
    <p>網址可能打錯了，或這篇文章已經搬家、下架。</p>
    <p><a href="./">回首頁看看有什麼</a></p>
  </section>

  <section class="post-list">
    <h2>目前的分區</h2>
    <ul class="cards">
${cfg.games.map(g => `      <li>
        <article class="card">
          <h3><a href="${escAttr(g.id)}/">${esc(g.emoji || '')} ${esc(g.title)}</a></h3>
          <p class="card-summary">${esc(g.tagline)}</p>
        </article>
      </li>`).join('\n')}
    </ul>
  </section>

  ${footerBlock(cfg, false, cfg.games)}
</main>`

  return page(cfg, {
    title: `找不到頁面｜${cfg.title}`,
    description: '這個網址沒有對應的頁面。',
    depth: false,
    body
  })
}

// ---------------------------------------------------------------- main

async function main () {
  const cfg = JSON.parse(await readFile(path.join(ROOT, 'site.config.json'), 'utf8'))

  if (!Array.isArray(cfg.games) || !cfg.games.length) {
    throw new Error('site.config.json 至少要有一款遊戲（games[]）')
  }

  const gameById = new Map(cfg.games.map(g => [g.id, g]))
  if (!gameById.has(cfg.defaultGame)) {
    throw new Error(`site.config.json 的 defaultGame「${cfg.defaultGame}」不在 games[] 裡`)
  }

  const posts = await loadPosts(cfg, gameById)

  // 遊戲頁與文章頁在同一層網址，撞名會互相覆蓋，先擋下來
  for (const p of posts) {
    if (gameById.has(p.slug)) {
      throw new Error(`posts/${p.slug}.md 的網址跟遊戲頁 /${p.slug}/ 撞名，請改檔名`)
    }
  }

  await rm(DIST, { recursive: true, force: true })
  await mkdir(DIST, { recursive: true })

  if (existsSync(STATIC_DIR)) await cp(STATIC_DIR, DIST, { recursive: true })

  await writeFile(path.join(DIST, 'index.html'), renderHome(cfg, posts, gameById))

  for (const game of cfg.games) {
    const dir = path.join(DIST, game.id)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'index.html'), renderGame(cfg, game, posts))
  }

  for (const post of posts) {
    const dir = path.join(DIST, post.slug)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'index.html'), renderPost(cfg, post, gameById.get(post.gameId)))
  }

  await mkdir(path.join(DIST, 'assets'), { recursive: true })
  await writeFile(path.join(DIST, 'assets', 'config.js'), renderConfigJs(cfg, posts))

  const sitemap = renderSitemap(cfg, posts)
  if (sitemap) await writeFile(path.join(DIST, 'sitemap.xml'), sitemap)

  await writeFile(path.join(DIST, '404.html'), render404(cfg))

  await writeFile(
    path.join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\n${cfg.baseUrl ? `Sitemap: ${cfg.baseUrl.replace(/\/$/, '')}/sitemap.xml\n` : ''}`
  )

  console.log(`✓ 建置完成：${cfg.games.length} 款遊戲、${posts.length} 篇文章`)
  for (const g of cfg.games) {
    const mine = posts.filter(p => p.gameId === g.id)
    console.log(`  /${g.id}/  ${g.title}（${mine.length} 篇）`)
    for (const p of mine) console.log(`    · /${p.slug}/  更新 ${p.updatedYmd}  ${p.title}`)
  }
  if (!cfg.supabase.url) console.log('! Supabase 未設定，計數器會顯示「—」（網站其他功能不受影響）')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

// 新增一篇文章的小工具
//
//   node new-post.mjs "文章標題"
//   node new-post.mjs "文章標題" my-custom-slug
//
// 會在 posts/ 產生 YYYYMMDD-slug.md，填好 frontmatter。
// 寫完內容後跑 `npm run build`，首頁卡片會自動長出來並排到最前面。

import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const POSTS = path.join(ROOT, 'posts')

const title = process.argv[2]
if (!title) {
  console.error('用法：node new-post.mjs "文章標題" [slug]')
  process.exit(1)
}

/** 標題轉網址片段；中文標題轉不出來時要求手動指定 */
function slugify (s) {
  return s
    .toLowerCase()
    .replace(/[^\w一-鿿\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[一-鿿]/g, '')   // 中文字元不適合放網址
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

const custom = process.argv[3]
const slugPart = custom || slugify(title)

if (!slugPart) {
  console.error('無法從標題自動產生網址片段（純中文標題會這樣），請手動指定：')
  console.error(`  node new-post.mjs "${title}" your-slug-here`)
  process.exit(1)
}

const now = new Date()
const p = n => String(n).padStart(2, '0')
const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
const slug = `${stamp}-${slugPart}`
const file = path.join(POSTS, `${slug}.md`)

if (existsSync(file)) {
  console.error(`檔案已存在：${file}`)
  process.exit(1)
}

const template = `---
title: ${title}
summary: 一兩句話，會顯示在首頁卡片上。
author: Will
date: ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}
tags: [心得]
---

先寫開場。

## 第一個小標

內容。
`

await mkdir(POSTS, { recursive: true })
await writeFile(file, template)

console.log(`✓ 已建立 posts/${slug}.md`)
console.log(`  網址將會是 /${slug}/`)
console.log('  寫完後跑：npm run build')

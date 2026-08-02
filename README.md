# 整理手記

一個寫「整理系」遊戲的中文部落格。靜態網站，零執行期相依套件。

目前收錄兩款遊戲，同一個網站、同一套版型：

| 路徑 | 遊戲 |
| --- | --- |
| `/hozy/` | 《Hozy》——回鄉整修房屋，沒有計時器與分數 |
| `/librarian/` | 《Librarian: Tidy Up the Arcane Library!》——把 3,072 本書歸位，有館長評分 |

> 專案資料夾仍叫 `hozy-blog`（Cloudflare Pages 與 `.claude/launch.json` 都指著它），改名要一起改，就先留著。

## 快速開始

```bash
npm run build     # 產生 dist/
npm run dev       # 建置並在 http://localhost:8788 預覽
```

## 新增一篇文章

```bash
node new-post.mjs "文章標題" some-slug librarian
```

第三個參數是文章歸屬的遊戲（`hozy` / `librarian`），省略就用 `site.config.json` 的 `defaultGame`。
會在 `posts/` 產生 `YYYYMMDD-some-slug.md`。編輯完成後：

```bash
npm run build
```

首頁與該遊戲頁的卡片會自動新增、依「最後更新時間」重新排序（最新的在最前面），日期也會自動更新。

## 新增一款遊戲

在 `site.config.json` 的 `games[]` 加一筆就會多出一個 `/<id>/` 專頁、導覽列多一項、首頁多一張卡片：

```json
{
  "id": "your-game",
  "name": "顯示在導覽列的短名",
  "emoji": "🎮",
  "title": "頁面大標",
  "tagline": "一句話介紹",
  "description": "段落介紹，也會當成該頁的 meta description",
  "storeUrl": "https://store.steampowered.com/app/...",
  "accent": { "light": "#6b53b8", "lightSoft": "#ded6f2", "dark": "#a891e8", "darkSoft": "#332a4d" },
  "hero": { "file": "assets/hero-xxx.jpg", "alt": "...", "width": 1920, "height": 1080 },
  "facts": [{ "label": "開發商", "value": "..." }],
  "disclaimer": "非官方粉絲站的權利聲明"
}
```

`hero` 若使用外部授權圖片，加上 `credit`（`title` / `author` / `authorUrl` / `sourceUrl` / `license` / `licenseUrl` / `source`），頁尾會自動列出完整出處；自製圖則用 `note` 寫一行說明。

## 設計上的幾個決定

| 決定 | 原因 |
| --- | --- |
| 卡片在建置時寫進 HTML | 爬蟲不需執行 JS 就能看到完整文章列表 |
| 「最後更新」取自 `.md` 檔的 mtime | 改檔案就會自動換日期，不用手動維護 |
| 文章網址維持扁平的 `/YYYYMMDD-slug/` | 改成多遊戲架構時舊連結不會壞掉；日期前綴讓排序與識別都直覺 |
| 遊戲頁放在 `/<gameId>/` | 每款遊戲有自己的入口、介紹與 canonical，不必為此多開一個網域 |
| 每款遊戲一組主色，用 `data-game` 覆蓋 CSS 變數 | 同一份樣式表服務所有遊戲，看得出區別又不會變成兩個站 |
| 主色規則內嵌在 `<head>` | 內容只有幾百位元組，不值得為它多一次請求 |
| HERO 圖限制在內容欄寬內 | 避免大圖在手機上壓迫閱讀節奏 |
| 計數器直接打 Supabase REST | 不必載入 SDK，少一個外部相依與一次額外請求 |

## 目錄結構

```
build.mjs              建置腳本（markdown 解析、版型、輸出）
new-post.mjs           新增文章的小工具
site.config.json       站台設定、games[]、HERO 圖出處、Supabase 金鑰
posts/*.md             文章原始檔（frontmatter 的 game: 決定歸屬）
static/                直接複製到 dist/ 的靜態檔
  assets/styles.css
  assets/counter.js
  assets/hero-cozy-apartment.jpg     Hozy 頁的 HERO（CC BY 2.0）
  assets/hero-arcane-library.svg     Librarian 頁的 HERO（本站自製）
dist/                  建置產物（已 gitignore）
```

輸出的網址：

```
/                      站台首頁：遊戲索引 + 全部文章（含遊戲標籤）
/<gameId>/             遊戲專頁：介紹、基本資料表、該遊戲的文章
/<YYYYMMDD-slug>/      文章頁
/sitemap.xml           有填 baseUrl 時才產生
```

## Supabase 計數器

在 `site.config.json` 填入：

```json
"supabase": {
  "url": "https://xxxxx.supabase.co",
  "anonKey": "eyJhbGci..."
}
```

資料庫需要一張表和一個函式，SQL 見 [`supabase/schema.sql`](supabase/schema.sql)。

計數的 slug 除了每篇文章，還包含 `__home__`（全站）與每個遊戲 id（各遊戲專頁）。
每頁帶 `data-primary` 的那顆計數器負責 +1，其餘卡片上的數字一次撈回來填。

未設定時計數器會顯示「—」，網站其餘功能不受影響。

## 圖片與版權

- Hozy 頁的 HERO 為 CC BY 2.0 授權，作者 Shixart1985，來源 Wikimedia Commons，完整出處標示於頁尾。圖片未經修改，僅縮放尺寸。
- Librarian 頁的 HERO 為本站自製 SVG 向量插畫，屬示意用途，不是遊戲畫面。

本站為非官方粉絲站。《Hozy》由 Come On Studio 開發、tinyBuild 發行；
《Librarian: Tidy Up the Arcane Library!》由 ArtRising 開發與發行。

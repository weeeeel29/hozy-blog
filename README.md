# Hozy 手記

關於遊戲《Hozy》的中文部落格。靜態網站，零執行期相依套件。

## 快速開始

```bash
npm run build     # 產生 dist/
npm run dev       # 建置並在 http://localhost:8788 預覽
```

## 新增一篇文章

```bash
node new-post.mjs "文章標題" some-slug
```

會在 `posts/` 產生 `YYYYMMDD-some-slug.md`。編輯完成後：

```bash
npm run build
```

首頁的卡片會自動新增、依「最後更新時間」重新排序（最新的在最前面），日期也會自動更新。

## 設計上的幾個決定

| 決定 | 原因 |
| --- | --- |
| 首頁卡片在建置時寫進 HTML | 爬蟲不需執行 JS 就能看到完整文章列表 |
| 「最後更新」取自 `.md` 檔的 mtime | 改檔案就會自動換日期，不用手動維護 |
| 文章網址為 `/YYYYMMDD-slug/` | 同一網域下的獨立路徑，日期前綴讓排序與識別都直覺 |
| HERO 圖限制在內容欄寬內 | 避免大圖在手機上壓迫閱讀節奏 |
| 計數器直接打 Supabase REST | 不必載入 SDK，少一個外部相依與一次額外請求 |

## 目錄結構

```
build.mjs              建置腳本（markdown 解析、版型、輸出）
new-post.mjs           新增文章的小工具
site.config.json       站台設定、HERO 圖出處、Supabase 金鑰
posts/*.md             文章原始檔
static/                直接複製到 dist/ 的靜態檔
  assets/styles.css
  assets/counter.js
  assets/hero-*.jpg
dist/                  建置產物（已 gitignore）
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

未設定時計數器會顯示「—」，網站其餘功能不受影響。

## 圖片授權

HERO 圖片為 CC BY 2.0 授權，作者 Shixart1985，來源 Wikimedia Commons，
完整出處標示於每一頁的 footer。圖片未經修改，僅縮放尺寸。

本站為非官方粉絲站。《Hozy》由 Come On Studio 開發、tinyBuild 發行。

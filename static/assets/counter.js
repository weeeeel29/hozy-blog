// 瀏覽計數器 —— 直接打 Supabase REST API，不載入 SDK（省一個外部相依）。
//
// 運作方式：
//   每頁有一顆「主要計數器」（帶 data-primary），對它的 slug +1
//   頁面上若還有其他計數器（首頁卡片、遊戲頁的文章卡片），一次撈回全部數字填進去
//
// 沒設定 Supabase 時整段安靜跳過，頁面其他部分照常運作（數字維持「—」）。

(function () {
  'use strict'

  var cfg = window.SITE_CONFIG || {}
  var BASE = (cfg.supabaseUrl || '').replace(/\/$/, '')
  var KEY = cfg.supabaseAnonKey || ''

  var nodes = document.querySelectorAll('.view-count[data-views]')
  if (!nodes.length) return

  if (!BASE || !KEY) {
    // 尚未設定：留著「—」就好，不要在 console 洗一堆錯誤
    return
  }

  var headers = {
    'apikey': KEY,
    'Authorization': 'Bearer ' + KEY,
    'Content-Type': 'application/json'
  }

  var fmt = function (n) {
    return typeof n === 'number' ? n.toLocaleString('zh-Hant') : '—'
  }

  var paint = function (slug, value) {
    var els = document.querySelectorAll('.view-count[data-views="' + CSS.escape(slug) + '"]')
    for (var i = 0; i < els.length; i++) {
      els[i].textContent = fmt(value)
      els[i].classList.remove('is-loading')
    }
  }

  // 主要計數器：首頁是 __home__、遊戲頁是遊戲 id、文章頁是文章 slug
  var primaryNode = document.querySelector('.view-count[data-primary][data-views]')
  var primarySlug = (primaryNode || nodes[0]).getAttribute('data-views')
  var hasOthers = nodes.length > 1

  for (var i = 0; i < nodes.length; i++) nodes[i].classList.add('is-loading')

  // 同一個瀏覽階段重整不重複計數
  var seenKey = 'tidy:seen:' + primarySlug
  var alreadySeen = false
  try {
    alreadySeen = sessionStorage.getItem(seenKey) === '1'
  } catch (e) { /* 無痕模式等情況：當作沒看過 */ }

  var incr = function (slug) {
    return fetch(BASE + '/rest/v1/rpc/increment_views', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ page_slug: slug })
    }).then(function (r) {
      if (!r.ok) throw new Error('increment failed: ' + r.status)
      return r.json()
    })
  }

  var readOne = function (slug) {
    return fetch(
      BASE + '/rest/v1/page_views?select=views&slug=eq.' + encodeURIComponent(slug),
      { headers: headers }
    ).then(function (r) {
      if (!r.ok) throw new Error('read failed: ' + r.status)
      return r.json()
    }).then(function (rows) {
      return rows && rows[0] ? rows[0].views : 0
    })
  }

  var readAll = function () {
    return fetch(BASE + '/rest/v1/page_views?select=slug,views', { headers: headers })
      .then(function (r) {
        if (!r.ok) throw new Error('read failed: ' + r.status)
        return r.json()
      })
  }

  var markSeen = function () {
    try { sessionStorage.setItem(seenKey, '1') } catch (e) { /* 忽略 */ }
  }

  var clearLoading = function () {
    var remaining = document.querySelectorAll('.view-count.is-loading')
    for (var i = 0; i < remaining.length; i++) remaining[i].classList.remove('is-loading')
  }

  var step = alreadySeen ? readOne(primarySlug) : incr(primarySlug).then(function (v) {
    markSeen()
    return v
  })

  step
    .then(function (v) { paint(primarySlug, v) })
    .catch(function (e) {
      console.warn('[counter] ' + primarySlug, e && e.message ? e.message : e)
      clearLoading()
    })

  // 卡片上的數字：一次撈回全部，逐一填入
  if (hasOthers) {
    readAll()
      .then(function (rows) {
        for (var i = 0; i < rows.length; i++) paint(rows[i].slug, rows[i].views)
        // 資料庫裡還沒有紀錄的顯示 0，不要一直卡在「—」
        var remaining = document.querySelectorAll('.view-count.is-loading')
        for (var j = 0; j < remaining.length; j++) {
          remaining[j].textContent = '0'
          remaining[j].classList.remove('is-loading')
        }
      })
      .catch(function (e) {
        console.warn('[counter] all', e && e.message ? e.message : e)
        clearLoading()
      })
  }
})()

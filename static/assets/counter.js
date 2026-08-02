// 全站瀏覽計數器 —— 打同一個 Pages 專案裡的 /api/views（Cloudflare D1）
//
// 全站只有一個數字：不分文章、不分遊戲，任何一頁被看都算進同一個總數。
// 顯示在每一頁的頁尾。
//
// 同一個瀏覽階段只加一次，之後改用唯讀查詢，避免使用者在站內點來點去就灌爆數字。

(function () {
  'use strict'

  var nodes = document.querySelectorAll('.view-count')
  if (!nodes.length) return

  var ENDPOINT = '/api/views'
  var SEEN_KEY = 'tidy:counted'

  var paint = function (value) {
    var text = typeof value === 'number' ? value.toLocaleString('zh-Hant') : '—'
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = text
      nodes[i].classList.remove('is-loading')
    }
  }

  var clearLoading = function () {
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('is-loading')
  }

  for (var i = 0; i < nodes.length; i++) nodes[i].classList.add('is-loading')

  var counted = false
  try {
    counted = sessionStorage.getItem(SEEN_KEY) === '1'
  } catch (e) { /* 無痕模式等情況：當作還沒算過 */ }

  fetch(ENDPOINT, { method: counted ? 'GET' : 'POST' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    })
    .then(function (data) {
      if (!counted) {
        try { sessionStorage.setItem(SEEN_KEY, '1') } catch (e) { /* 忽略 */ }
      }
      paint(data.count)
    })
    .catch(function (err) {
      console.warn('[counter]', err && err.message ? err.message : err)
      clearLoading()
    })
})()

// 全站瀏覽計數器 —— Cloudflare Pages Function + D1
//
//   POST /api/views   加一，回傳新的總數
//   GET  /api/views   只讀，不加
//
// 用 UPDATE ... RETURNING 一次完成「加一並取回新值」，不是先 SELECT 再 UPDATE，
// 所以同時湧入的請求不會互相蓋掉。

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // 計數器一定要拿到即時值，不能讓 CDN 或瀏覽器快取
      'cache-control': 'no-store'
    }
  })

export async function onRequestGet (context) {
  try {
    const row = await context.env.DB.prepare('select count from views where id = 1').first()
    return json({ count: row ? row.count : 0 })
  } catch (err) {
    return json({ error: 'read failed', detail: String(err) }, 500)
  }
}

export async function onRequestPost (context) {
  try {
    const row = await context.env.DB
      .prepare('update views set count = count + 1 where id = 1 returning count')
      .first()

    // 資料列不見時（理論上不會）補建一列，避免計數器整個掛掉
    if (!row) {
      await context.env.DB.prepare('insert or ignore into views (id, count) values (1, 1)').run()
      return json({ count: 1 })
    }

    return json({ count: row.count })
  } catch (err) {
    return json({ error: 'increment failed', detail: String(err) }, 500)
  }
}

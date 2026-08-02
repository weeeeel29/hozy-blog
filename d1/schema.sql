-- 全站瀏覽計數器（單一計數器）
--
-- 套用方式：
--   wrangler d1 execute hozy-blog-views --remote --file d1/schema.sql
--
-- 只有一列（id = 1）。Pages Function 用 UPDATE ... RETURNING 一次完成
-- 「加一並取回新值」，不需要先讀再寫，也就沒有並發時互相蓋掉的問題。

create table if not exists views (
  id      integer primary key,
  count   integer not null default 0
);

insert or ignore into views (id, count) values (1, 0);

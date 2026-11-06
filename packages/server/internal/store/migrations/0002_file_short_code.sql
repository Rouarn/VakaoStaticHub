-- 图片对外标识改为内容短码：由「内容 sha256 + 根/分类/相对路径」派生 12 位十六进制。
-- 列先建出来，历史数据的回填与唯一索引放在服务启动时执行：
-- SQLite 没有内置 sha256，且唯一索引必须等所有行都填好码之后才能建。
ALTER TABLE file_entries ADD COLUMN short_code TEXT NOT NULL DEFAULT '';

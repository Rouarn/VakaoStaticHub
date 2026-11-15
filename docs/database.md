# 数据库

[← 返回索引](../README.md)

- 数据库使用 SQLite WAL 模式，迁移文件内嵌在二进制中，启动时自动执行
- 数据库文件路径由 `DB_PATH` 指定，默认 `<BASE_DIR>/data/vakao.db`（见 [配置说明](./configuration.md)）
- 旧 NestJS 后端已移除，其最后状态保存在 Git 标签 `archive/nestjs-backend`
- 旧数据快照保留在仓库根 `legacy-data/`（已 gitignore，仅作备份）

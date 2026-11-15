# resource-roots.json（可选，仅用于首次播种）

[← 返回索引](../README.md)

这个文件**只有一个用途**：服务首次启动、且数据库根目录表为空时，用来播种根目录。它不是运行期配置，也不是根目录的唯一来源——根目录的真正来源是数据库。

- **何时读**：启动时先查 `resource_roots` 表。只有表为空（全新库）才去读 `<BASE_DIR>/resource-roots.json`；表里已有根目录则直接跳过，连文件都不会打开。
- **读到什么**：按 JSON 数组逐项创建根目录（`id`、`name`、`path`、`description`），同时创建对应目录。`path` 为相对路径时按 `BASE_DIR` 解析，绝对路径原样使用；`id` 或 `path` 为空的条目会被跳过。
- **读不到怎么办**：文件不存在时使用代码内置的两个根：`default`（`FILE_ROOT`）与 `software-update`（`FILE_ROOT/software-update`），所以该文件是可选的。文件存在但不是合法 JSON 数组时启动直接失败（不会静默忽略），删掉该文件即可恢复默认播种。
- **之后会不会再读**：不会。播种只在空库时发生一次，后续启动不再读取；页面上的根目录增删改只写数据库，**不会回写**这个文件。
- **删了会怎样**：首次启动完成后可以安全删除，不影响正常运行；只有把数据库清空重来（例如删除 `data/vakao.db`）才会再次需要它。
- **仓库根目录那份**：`./resource-roots.json` 是本地开发用的播种样例（默认根指向 `legacy-data/`），不入库、不打进发布包。发布包 `.env` 里仍保留 `RESOURCE_ROOTS_FILE=resource-roots.json` 这一项，但因为包内没有该文件，线上首启走的是内置默认值。

路径相关的其它变量（`FILE_ROOT`、`RESOURCE_ROOTS_FILE`、`BASE_DIR`）见 [配置说明](./configuration.md)。

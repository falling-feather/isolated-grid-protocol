# 核心源码归档

日期：2026-10-24。本次为源码归档，不分配产品版本。

从Git暂存文件导出到独立目录，以本机已有依赖执行以下检查，使用Node.js 24.20.0：

| 检查 | 实际命令 | 结果 |
| --- | --- | --- |
| test | `node --test tests/*.test.mjs` | 通过 |
| check | `tsc --noEmit -p tsconfig.json` | 通过 |
| build | `tsc -p tsconfig.json && node scripts/build.mjs` | 通过 |

此次核对覆盖核心源码纳入范围、构建和已有自动检查，没有重新执行完整浏览器试玩、跨设备性能或真人使用评估，也未执行全新联网安装。既有第三方许可保留。

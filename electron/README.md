# CS2 Cam 桌面端

Electron 管理窗口、受限 preload、本地后端生命周期、录制工具设置和在线更新。正式统计使用 SQLite；便携版自带 Java/Python，不需要 MySQL。

## 源码运行

先按根目录 [README](../README.md) 安装依赖并构建，运行 `start-electron.bat`。启动脚本初始化 SQLite、构建前后端并启动 Electron；需要 `.venv312`、Node.js、Maven 和 JDK 17。

## 便携版构建

使用唯一正式构建入口 `tools/build_portable.py`，说明见 [构建文档](../README.md)。默认不附带 HLAE 或 FFmpeg；用户可在设置页安装录制工具。

版本由 `package.json` 提供。在线更新读取 GitHub 稳定 Release，下载 ZIP 与 SHA-256 校验文件，通过 `install-update.ps1` 安装、保留个人数据并支持失败回滚。

用户运行指南见 [CS2 Cam 使用说明](../CS2_CAM_QUICK_START.md)。

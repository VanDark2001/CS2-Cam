# CS2 Cam

本地运行的 **CS2 比赛分析、2D 战术回放与玩家 POV 录制工具**。当前稳定版：**0.1.1**，支持 Windows x64。

[下载最新版](https://github.com/VanDark2001/CS2-Cam/releases/latest) · [发行记录](https://github.com/VanDark2001/CS2-Cam/releases) · [反馈问题](https://github.com/VanDark2001/CS2-Cam/issues)

## 功能

- 导入 CS2 Demo，查看比赛比分、玩家表现、武器统计、高光和残局分析。
- 2D 战术地图按回合回放玩家位置、投掷物与比赛事件。
- 录制多玩家 POV，进入回合后完整缓存该回合的视频，共享播放、暂停和跳转时间轴。
- 点击玩家切换到个人事件，包含投掷、击杀与死亡；点击空白区域恢复全局事件。
- 点击事件跳到发生前 3 秒，方便查看出手过程；支持收藏回合与玩家组合。
- 设置页检测录制环境、调整录制参数，并检查和安装 GitHub 稳定版本更新。

## 下载与运行

1. 在 [最新发行版](https://github.com/VanDark2001/CS2-Cam/releases/latest) 下载 `CS2-Cam-0.1.1-win-x64.zip`。
2. 完整解压到可写目录，运行 `CS2 Cam.exe`，不要直接在压缩包内运行。
3. 在解析页导入本地 `.dem` 文件，完成解析后进入比赛记录或 2D 回放。

发行包附带 Java 和 Python 运行环境，无需另行安装。首次启动是空数据库；不附带作者的 Demo、统计数据库、头像缓存或录制视频，也不附带 HLAE、FFmpeg/FFprobe。Electron 自带的 `ffmpeg.dll` 是桌面运行环境的一部分。

### 录制 POV

统计分析和已有视频查看不要求安装录制工具。需要生成新的 POV 时：

1. 在设置页在线安装 HLAE 和 FFmpeg（同时补全 FFprobe），或选择本机已有的完整工具。
2. 选择本机 CS2 游戏程序，启动 Steam，并关闭普通 CS2 游戏实例。
3. 在回放页选择需要录制的玩家与回合，启动录制任务。

工具检测失败时，查看设置页的路径与错误说明；在线安装需要能够访问工具的 GitHub 下载地址。

### 数据与在线更新

个人数据默认保存在 `resources/project/data`，也支持软件旁已有的 `data` 目录。比赛、Demo、POV、收藏与录制配置都应随软件目录一起保留；备份时请先退出软件并备份数据目录。

默认启动后自动检查 GitHub 稳定发行版，也可在设置页手动检查。点击“下载并安装”后，软件下载完整更新包并校验 SHA-256，退出后安装并重启，保留个人数据；安装失败会尝试回滚。解析或录制任务进行中时需先完成任务再更新。

发行版提供 ZIP 的 `.sha256` 校验文件，可用 PowerShell `Get-FileHash -Algorithm SHA256` 核对下载内容。

## 作者

<img src="web/public/author/bilibili-avatar.jpg" width="72" height="72" alt="作者 B 站头像">

[B 站主页](https://space.bilibili.com/24855799) · [GitHub 主页：VanDark2001](https://github.com/VanDark2001)

## 源码开发

正式项目由根目录 Python 解析器、`server/` Spring Boot 后端、`web/` Vue 前端和 `electron/` 桌面壳组成，共享 SQLite 数据库。队伍按 `match_players.team_number` 分组，统计口径见 [统计规则](STATISTICS_RULES.md)。

需要 Node.js 24、JDK 17、Maven、Python 3.12、Go 1.24+。在仓库根目录执行：

```powershell
python -m venv .venv312
.venv312/Scripts/python.exe -m pip install -r requirements-desktop.txt
cd web
npm ci
npm run build
cd ../electron
npm ci
cd ../server
mvn -q -DskipTests package
cd ../tools/replay_positions
go build -o replay_positions.exe .
cd ../..
./start-electron.bat
```

更新功能验证与便携打包：

```powershell
node --test electron/updater.test.cjs
python -m unittest discover -s tests -p test_update_installer.py
.venv312/Scripts/python.exe tools/build_portable.py --skip-build --java-home $env:JAVA_HOME --zip
```

不指定 `--hlae-home` 即不打包录制工具。打包输出位于 `.cache/portable-builds`，包含完整性清单和 ZIP 校验文件。发布时同步修改 `electron/package.json` 与锁文件中的项目版本，推送对应 `vX.Y.Z` 标签；GitHub Actions 支持构建并发布发行包。

不要提交 `.env`、Demo、数据库、日志、个人头像缓存、虚拟环境、`node_modules`、`target` 或 `dist`。

## 外观模式（0.1.2 开发版）

设置页提供浅色、深色与自动三种模式。浅色使用终末地风格的暖白、浅灰、深色文字与黄绿强调。自动模式按电脑本地时间 07:00–19:00 使用浅色，其余时段深色；偏好本地保存，手动模式不受时间覆盖。

## 源码结构

- 根目录：正式 Demo 解析、SQLite schema、统计评分、致盲/回放处理与 Steam 头像获取。`demoparser2_mysql.py` 保留兼容文件名，实际使用 SQLite。
- `server/`、`web/`、`electron/`：后端、前端与桌面端。
- `tools/build_portable.py`：正式打包入口；`tools/record_worker.py`、`tools/pov/` 与 `tools/replay_positions/`：正式回放/录制链路。
- `tests/` 与相邻测试文件：持续回归测试；`文档：使用、构建与统计说明。

已移除旧 MySQL 迁移、一次性数据库压缩/校验、手工清空、成品刷新、临时发行组装和早期 POV 替代脚本。

## 0.1.1 更新

- 删除设置页的“项目源码”入口，保留 B 站主页与作者 GitHub 主页。
- 删除 2D 地图上的装饰性 `PLAYER FOR POV` 提示文字。
- 完善仓库首页说明。

## 第三方资源与声明

游戏地图、武器与 HUD 资源权利属于其权利方，见 [资源来源](GAME_ASSETS.md)。运行环境保留各组件许可证，见 [第三方声明](PORTABLE_THIRD_PARTY.md)。项目目前未指定额外的源码授权许可证。

## 源码发布过滤

在 Git 检出目录运行 `python tools/export_source.py --output .cache/CS2-Cam-source.zip`。导出自动排除 `AGENTS.md`、本地 `docs` 交接/设计/模板资料、个人数据、环境配置与构建产物；仅提取使用指南、统计口径、游戏资源来源及第三方声明。发布源码使用该导出入口，不直接压缩开发目录。

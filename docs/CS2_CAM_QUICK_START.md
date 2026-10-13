# CS2 Cam 0.1

下载 Windows x64 ZIP，完整解压到一个可写目录，运行 `CS2 Cam.exe`。
软件附带 Java/Python 运行环境，无需自行安装。首次启动初始化空数据库。

本版本包含比赛统计、玩家分析、2D 战术回放、POV 录制/播放、收藏与版本更新。
不附带 Demo、数据库、录制视频、个人 Steam 配置、HLAE 或 FFmpeg/FFprobe。
统计和回放不需要录制工具；生成 POV 前在设置页在线安装 HLAE、FFmpeg/FFprobe，
选择本机 `cs2.exe`，启动 Steam 并关闭普通 CS2。

设置页默认在启动后检查 GitHub 稳定新版本。点击“下载并安装”后下载完整发行包，
验证 SHA-256，等待本次程序退出，备份被覆盖的应用文件、安装并重新启动。
失败时回滚原文件。解析、导入、录制任务运行时不能安装更新。

个人数据保存在 `resources/project/data`；若使用软件同目录的 `data` 或迁移后的
自定义数据目录，继续使用原目录。更新不会覆盖数据库、Demo、头像、POV、
收藏、录制 CFG、工具路径及自行安装的工具。移动软件时请一并保留数据目录。

- 作者 B 站：https://space.bilibili.com/24855799
- 作者 GitHub：https://github.com/VanDark2001
- 项目与版本：https://github.com/VanDark2001/CS2-Cam
- 第三方声明：`resources/licenses/THIRD-PARTY.md`

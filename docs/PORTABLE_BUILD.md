# CS2 Cam Windows 便携版构建

正式构建入口为 `tools/build_portable.py`。数据库使用 SQLite，运行时包括 Electron、Java 17、Python 3.12 和 Go 回放导出器。

## 准备

按根目录 README 安装依赖，使用 Windows x64 Python 3.12 虚拟环境与含 jlink 的 JDK 17。需要 Node.js、Maven、Go 1.24+；先构建 Spring Boot JAR、Vue 静态文件与 Electron 依赖。

```powershell
.venv312/Scripts/python.exe tools/build_portable.py --java-home $env:JAVA_HOME --zip
```

若复用已构建结果，明确指定 `--skip-build --jar server/target/demo-show-0.0.1-SNAPSHOT.jar`。构建器默认生成新目录，不覆盖运行中的成品。

## 输出

输出位于 `.cache/portable-builds/<UUID>/CS2 Cam`，最近成功路径写入 `.cache/portable-build-latest.json`。传入 `--zip` 时，同时生成 `CS2-Cam-<version>-win-x64.zip` 与 `.sha256`。

默认不附带 HLAE、FFmpeg/FFprobe，用户在设置页在线补全。只有制作明确需要内置工具的包时才使用 `--hlae-home <完整工具目录>` 和可选 `--ffprobe`。

不复制 `.env`、开发数据库、Demo、头像缓存、录制视频或虚拟环境启动器。更新清单列出应用文件的 SHA-256；普通公开发行包拒绝混入个人数据与独立录制工具。

## 验证与发布

```powershell
node --test electron/portable-runtime.test.cjs electron/updater.test.cjs
python -m unittest discover -s tests -p test_update_installer.py
```

先验收启动、解析、回放和所需录制功能。发布时同步 `electron/package.json` 和锁文件版本，推送匹配的 `vX.Y.Z` 标签，GitHub Actions 构建发行包。需要与自动更新兼容的 ZIP 必须使用正式构建器的目录结构、更新清单和校验文件。

用户更新使用设置页的“检查更新 → 下载并安装”。源码修改后重新构建新目录，不使用旧的成品刷新或数据库修补脚本。

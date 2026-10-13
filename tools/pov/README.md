# HLAE POV 导出

正式流程为后端 → `export_single_pov.ps1` → `tools/record_worker.py` → `hlae_wrapper.ps1` → `hlae_wrapper.py` → `batch_capture.js`，最后由 FFmpeg 合并音视频。机器需要已安装 CS2、HLAE、FFmpeg 和 FFprobe，Steam 必须运行；相关路径使用 `CS2_EXE`、`HLAE_EXE`、`FFMPEG_EXE`、`FFPROBE_EXE`。FFprobe 默认优先使用 FFmpeg 同目录，再从 PATH 查找；HLAE 自带目录可能只有 FFmpeg。

## 独立录制配置

- 默认目录为项目根目录 `.pov-profile/cfg/`，已加入 Git 忽略规则。首次启动由 CS2 自动生成独立的 `cs2_video.txt`、机器设置、按键等配置，不复制 Steam userdata 中的个人配置。
- HLAE Custom Loader 使用 `-addEnv USRLOCALCSGO=<项目>/.pov-profile` 重定向本地设置，同时保留 `-afxDisableSteamStorage` 关闭该录制实例的云配置读写。仅关闭云同步并不能隔离本地视频设置。
- 录制启动默认使用 1920×1080 窗口模式，分辨率仅写入独立配置。画质可以在录制实例内调整，保存在此目录，不回写日常游戏设置。
- 录制启动/停止 CFG 也放在独立目录，保留每任务唯一文件名。独立 `autoexec.cfg` 避免继承游戏安装目录的个人 autoexec，已有录制专用设置不会被覆盖。
- 使用 `-noConfig` 避免自动启动覆盖 HLAE 本身的已保存设置。按照官方 CS2 启动器设置 `SteamPath`、`SteamClientLaunch=1` 和 CS2 的三个 App/Game ID 环境变量；缺少这些环境会出现本地 Steam IPC 连接错误。
- CS2 仍只允许一个运行实例。普通游戏或上一次录制仍在运行时，本次任务报错提示手动关闭，不会再按进程名强杀所有 CS2。

对应实现：`recording_profile.py`。依据 HLAE v2.192.5 官方源码：[独立配置与 Steam 启动环境](https://github.com/advancedfx/advancedfx/blob/v2.192.5/hlae/LaunchCs2.cs)、[USRLOCAL 路径重定向](https://github.com/advancedfx/advancedfx/blob/v2.192.5/AfxHookSource2/main.cpp)。

## POV 身份与视角验证

`batch_capture.js` 按真实 SteamID 找到 controller，再使用数字实体索引 `spec_player <index>` 和明确的 `spec_mode 2`（CS2 第一人称），不按昵称猜测，不循环切换模式。

每名玩家都会重新加载/锁定，在起点之前稳定观战，再回到指定 start tick 验证身份与模式后开录。存活时若变为第三人称或其他玩家，立即结束并使任务失败。所有人录制同一区间，死亡不截断：用 `cViewRenderSetupView` 保存最后经过本人身份验证的镜头，确认死亡后固定在本人死亡地点继续录到 end tick。切到不跟随玩家的 observer mode 4 去掉他人的武器/HUD，渲染镜头始终由脚本固定，不允许自动观战队友。这是固定死亡地点视角，不是跟随击杀者的原生击杀镜头。每位玩家重新清空死亡状态和相机覆盖。

`capture_monitor.py` 使用只监听 `127.0.0.1` 的临时 WebSocket 和每任务随机 token 收集 `capture-events.jsonl`。Python 在发布结果前检查全部玩家的身份、第一人称开录、共同起止 tick、round_end 与完成标志。FFprobe 分别检查视频/音频的实际时长，允许最多 0.5 秒编码误差；截短视频、截短音频和不完整区间不得发布。需要 `websockets>=15,<16`，已加入根目录 requirements。

## 播放同步

`web/src/lib/povPlayback.js` 与 `ReplayPage.vue` 以回合 start tick 为全部视频的时间零点。取消旧的“回合时长减视频时长”偏移猜测：早死短视频不再被推迟到回合尾。旧截短 POV 到结尾保持末帧，不因浏览器自动 pause 而暂停其他 POV/共享回放时钟；拖回开头可重新播放。旧文件无法补回死亡后的场内画面，仍需重新导出。

批量 worker 的等待上限按玩家数、完整区间和逐次启动/收尾开销计算，至少保留 900 秒，不再以固定 15 分钟截断十人全回合导出。

## 验证

```powershell
.venv312/Scripts/python.exe -m unittest discover -s tests -p test_recording_profile.py -v
.venv312/Scripts/python.exe -m unittest discover -s tests -p test_capture_monitor.py -v
.venv312/Scripts/python.exe -m py_compile tools/pov/recording_profile.py tools/pov/hlae_wrapper.py tools/pov/capture_monitor.py
node --test tools/pov/batch_capture.test.js
```

# CS2 回放图标来源

游戏资源来源为 CS2 安装目录的 `game/csgo/pak01_dir.vpk`。

- 彩色道具：游戏的 `panorama/images/econ/weapons/base_weapons/weapon_<名称>_png.vtex_c`，转换输出在 `work/weapon_extract/panorama/images/econ/weapons/base_weapons/`，页面文件在 `web/public/weapons/<名称>.png`。烟雾弹、手雷、闪光弹、燃烧瓶、燃烧弹、诱饵弹与 C4 均使用这些原有资源。
- 武器、卡片道具和护甲剪影：游戏的 `panorama/images/icons/equipment/<名称>.vsvg_c`，页面文件在 `web/public/weapons-flat/`。
- 卡片死亡符号：游戏的 `panorama/images/hud/deathnotice/icon_suicide.vsvg_c` 中原始 SVG 数据块，页面文件为 `web/public/weapons-flat/icon_suicide.svg`。仅作为统计栏死亡符号，不表示该玩家发生自杀。
- 爆头图标：游戏的 `panorama/images/hud/deathnotice/icon_headshot.vsvg_c`。

`gameIcons.js` 使用原图透明内容边界绘制，保持比例和原色，不修改 PNG；加载失败回退到对应游戏 HUD SVG。地图水滴编号、计时容器、轨迹与枪口提示是页面的展示元素，不冒充游戏原始资源。

布局、人物编号、地图校准与实际烟雾/火焰范围不受图标尺寸调整影响。普通计时容器由 40px 缩小到 28px，C4 由 48px 缩小到 32px，飞行道具由 15px 缩小到 11px。

## 雷达与地图徽章（2026-10-09）

`web/public/maps/*.png` 是列表和收藏夹的地图徽章；`web/public/maps/radar/*.png` 必须是回放 2D 底图，二者不可混用。

本轮发现 Anubis、Nuke、Overpass、Train、Vertigo 的 radar 文件与对应徽章逐字节相同，均为 512×512。已从游戏 `pak01_dir.vpk` 的 `panorama/images/overheadmaps/<map>_radar_psd.vtex_c` 用Source2 Viewer CLI 转换为 1024×1024 PNG，保留透明背景、方向和完整坐标范围；不裁切、不旋转、不重绘。仅替换这五张，原有 Ancient、Cache、Dust2、Inferno、Mirage 雷达和所有徽章保持不动。

坐标校准依据游戏 `resource/overviews/*.txt`，入口为 `web/src/lib/radarAssets.js`。

- Anubis：`pos_x=-2796`、`pos_y=3328`、`scale=5.22`，修复原先缺失而误用 Mirage 的参数。
- Train：`pos_x=-2308`、`pos_y=2078`、`scale=4.082077`，与本次提取的当前游戏雷达配套，不沿用旧 Train 参数。
- Nuke、Overpass、Vertigo 的现有参数与对应 overview 一致，保持不变。

Nuke、Train、Vertigo 还包含 lower 图，当前 UI 只使用默认层，本次未实现自动楼层切换。其他年代 Demo 若地图几何不同，仍需要对应版本的资源和校准，不把当前游戏底图宣称为所有历史版本通用。

运行时拒绝加载失败、非方形或小于 1024px 的纹理；未知地图不再使用 Mirage 校准绘制玩家。`node --test web/src/lib/radarAssets.test.js` 检查十张雷达尺寸、与徽章不同、坐标转换及错误资源拒绝。

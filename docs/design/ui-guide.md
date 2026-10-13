# CS2 Demo Show · 终末地 UI 指导

这份文件是前端视觉方案的执行入口。它把参考项目和资源站点中的工业终端感，转换为 CS2 数据分析产品可以长期复用的组件、图标和动效规则。

## 参考方向

- [Endfield Charge Plus](https://github.com/GlacierGlimmer/zmd-charge-plus)：深色桌面 HUD、黄绿色状态环、胶囊容器和状态变化动画。
- [zmd-charge](https://github.com/QinAnze/zmd-charge)：终末地风格的电量提示和短时展开/收回节奏。
- [ignoredone 资源页](https://www.ignoredone.space/index.php/resource/)：大字标题、年份/编号锚点、资源卡片、线性图标和页面进入动效。

## 视觉基线

```css
--color-page-bg: #191a19;
--color-surface: #212220;
--color-surface-raised: #2a2b28;
--color-border: #474941;
--color-text-primary: #e9e7e4;
--color-text-secondary: #9b9c94;
--color-brand: #c6ca4c;
--color-danger: #ff6b65;
```

页面使用碳黑底、米白正文和黄绿色行动色。黄绿色可以表达品牌、当前选择、进度和成功；失败、警告和阵营仍必须配合文字或图标，不能只靠颜色区分。

## 图标规则

`EndfieldIcon` 是页面内唯一的线性图标入口，位于 `web/src/components/EndfieldIcon.vue`。

- 图标使用 24×24 viewBox、1.45px 描边、直角端点和不填充几何形状。
- 导航图标使用 `matches`、`replay`、`players`、`weapons`、`map`、`stats`、`archive`。
- 动作图标使用 `upload`、`chevron`、`pulse`；不能用 emoji 代替业务图标。
- 默认尺寸 16px，页头导航 14px，空态或状态徽标最多 20px。
- 图标旁边保留中文业务名称；图标不能成为唯一信息载体。

## 动效规则

页面进入使用一次性的 `ef-enter`：透明度从 0 到 1、向上移动 8px，时长 240ms。卡片按 45ms 的延迟递进，最多延迟 180ms，帮助用户建立信息层级。

状态变化使用 `ef-pulse`，只在解析进行中或实时数据更新时使用；扫描线使用 `ef-scanline`，只出现在状态条和 HUD 预览区域。用户开启减少动态效果时，所有动画必须停用或缩短为即时切换。

## 页面应用

- 比赛页：列表项显示地图图标和比赛状态，当前比赛使用左侧黄绿色状态线。
- 统计页：指标卡使用编号标签，图表只使用品牌黄绿、阵营蓝和警示黄。
- 解析页：上传动作使用 `upload`，队列状态使用 `pulse` 或明确状态图标。
- 回放页：播放、下一回合和进度条保持清晰，雷达与击杀提示不使用持续闪烁。

## 回放页专项规则

- 比赛删除属于次级危险操作：使用细边框、低饱和红色和垃圾桶线性图标，放在“2D 回放”之后；悬停、禁用和键盘焦点必须有明确状态，但不能抢过主要入口。
- 回合时间轴必须使用后端 `scoreTimeline.team` 与 `team2Side` 推导胜方阵营。CT 胜使用蓝色（常态 `#245c91`、当前回合 `#4aa3ff`），T 胜使用黄褐色（常态 `#8a681d`、当前回合 `#f3bf4c`），没有记录时使用中性灰，并保留文字图例和悬停提示。
- 时间轴颜色只表达胜方，当前回合仍通过高亮边框和光晕表达；不得只依赖颜色传递信息，按钮必须带有“第 N 回合 · CT 胜/T 胜/未记录”的可访问名称。
- 2D 地图区域使用统一边框、内嵌细框和 `2D TACTICAL MAP // LIVE FRAME` 状态标识；装饰层不能遮挡雷达、队伍信息或击杀提示。

## 验收

- 桌面和窄窗口都能完成导航、比赛选择、解析入口和回放入口。
- 加载、无数据、失败和数据不完整状态都有文字说明。
- `npm run build` 必须通过。
- 视觉装饰不得覆盖表格、图表或关键操作。

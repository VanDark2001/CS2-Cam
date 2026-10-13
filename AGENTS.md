# CS2 Demo Show 项目规则

- 正式项目由根目录 Python 解析器、`server/` Spring Boot 后端和 `web/` Vue 前端组成。
- SQLite `csdemo.sqlite3` 是统计数据的唯一真实来源；队伍严格按 `match_players.team_number` 分组。
- 正式统计规则见 `docs/STATISTICS_RULES.md`。
- 后端采用 Controller → Service → Repository 分层，不把 SQL 或统计逻辑放回 Controller。
- 后端修改后运行 `mvn -q -DskipTests package`；前端修改后运行 `npm run build`。
- 不提交 `.env`、Demo、头像、数据库、日志、虚拟环境、`node_modules`、`target` 或 `dist`。
- 保留无关用户修改，不执行破坏性 Git 操作。

## 设计声明

开始设计或修改 `web/` 页面前，必须先读取以下文件：

- `docs/design/spec.md`：页面目标、功能、状态流和验收标准
- `docs/design/domain.md`：CS2 业务语义、统计口径和领域边界
- `docs/design/craft.md`：信息层级、排版密度、动效和视觉工艺
- `docs/design/design.md`：颜色、字体、间距、圆角、状态和响应式视觉系统
- `docs/design/components.md`：组件的适用范围和语义边界
- 对应的 `docs/design/templates/*.md`：页面骨架和场景结构

如果任务涉及新页面，先选择或新增对应模板；如果现有规则不足，先补充设计声明，再修改页面代码。完成后按照 `spec.md` 和 `domain.md` 验收，并运行前端构建。

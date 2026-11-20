# P0 视觉证据

基线：`3fb2f435`（仓库只有 README，学生端 URL 返回 404）→ 本 PR head。

| 场景 | 基线（before） | 本 PR（after） |
| --- | --- | --- |
| 桌面 1440×900 应用入口 | `../before/before-app-404-desktop.png` | `after-auth-zh-desktop.png` |
| 移动 390×844 应用入口 | `../before/before-app-404-mobile.png` | `after-map-zh-mobile.png` |
| 学生首页 / 地图 | — | `after-home-zh-desktop.png` / `after-map-zh-desktop.png` |
| 战斗 / 答题反馈 | — | `after-battle-zh-desktop.png` / `after-battle-feedback-zh-desktop.png` |
| 结算 / 错题 / 成长 | — | `after-result-zh-desktop.png` / `after-mistakes-zh-desktop.png` / `after-growth-zh-desktop.png` |
| 家长报告 | — | `after-parent-zh-desktop.png` |
| 教研后台 | — | `after-admin-dashboard-zh-desktop.png` / `after-admin-import-preview-zh-desktop.png` / `after-admin-ai-zh-desktop.png` |
| 英文界面 | — | `after-home-en-desktop.png` / `after-map-en-desktop.png` |

截图由 `npm run screenshots`（`e2e/screenshots.mjs`）在隔离的临时数据库上生成，视口固定为 1440×900 / 390×844。基线截图来自同一基线提交：应用尚不存在，打开学生端返回 404。

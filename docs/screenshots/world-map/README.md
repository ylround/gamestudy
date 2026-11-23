# 冒险地图：before / after

基线：`9fbbff5`（文字列表式地图：四个领域卡片 + 关卡行）。
After：本 PR 后续提交（区域化世界地图 + 蜿蜒路径 + 12 个关卡节点 + 勇者当前位置）。

| 场景 | Before | After |
| --- | --- | --- |
| 1440×900 中文地图 | `before-map-desktop.png` | `after-map-desktop.png` |
| 1024×768 中文地图 | — | `after-map-small.png` |
| 390×844 中文地图（移动端内部横向滑动） | `before-map-mobile.png` | `after-map-mobile.png` |

Before 是文字列表；After 在 1440 宽度显示整张数境世界地图，1024 下按容器缩放，390 下地图保持 940px 绘制宽度并允许在容器内左右滑动。实测 390 宽度：文档 `scrollWidth = 390`（无页面横向溢出），地图容器 `scrollWidth = 940 / clientWidth = 356`。

节点状态：金色勾选=已通关，青色脉冲=当前关卡，灰色锁=未解锁；勇者头像标记当前位置。点击任意已解锁节点进入答题战斗。

截图由 Playwright 在隔离的临时数据库 / `9fbbff5` 独立 worktree 上生成，同一视口、同一登录状态。

# 战斗可见性与动画：before / after

基线：`c8bb03c`（P0 MVP 初始战斗页，答题/反馈时页面会滚动，战斗场景可能离开视口）。
After：本 PR 后续提交（战斗场景固定在答题卡上方 + 施法/反击/受击/扣血动画）。

| 场景 | Before | After |
| --- | --- | --- |
| 1440×900 答题前 | `before-battle-desktop.png` | `after-battle-desktop.png` |
| 1440×900 答对反馈 | `before-feedback-desktop.png` | `after-feedback-desktop.png` |
| 1440×900 答错反击 | — | `after-counter-desktop.png` |
| 1024×768 答对反馈 | — | `after-feedback-small.png` |
| 390×844 答题前 | `before-battle-mobile.png` | — |
| 390×844 答对反馈 | `before-feedback-mobile.png` | `after-feedback-mobile.png` |

Before 移动端实测：答题反馈后 `scrollY = 217`，`.arena` 顶部 `-0.7px`，战斗场景已经离开视口。
After 实测（1440 / 1024 / 390）：`scrollY = 0`，战斗区与答题卡全部在视口内；提交后存在 `.fx-projectile`、`.fx-impact`、`.fx-damage`，阶段文案为“施法命中”或“怪物反击”。

截图由 `e2e` 脚本在隔离的临时数据库上生成；before 使用 `c8bb03c` 的独立 worktree 和同一视口、同一登录/关卡状态。

# 冒险地图设计

## 1. 参考的市面做法

- **Prodigy Math** 的世界地图按区域/生物群系组织（如 Firefly Forest、Shiverchill Mountains），玩家在地图上移动、进入关卡和任务；区域有明确的视觉主题与场景氛围。[Prodigy: Firefly Forest](https://webflow.prodigygame.com/main-en/blog/prodigy-game-update-firefly-forest)
- **Duolingo** 的学习路径用一条连续的蜿蜒路径串联关卡节点，节点有已完成/当前/锁定状态和角色位置，玩家一眼能看出“下一步在哪里”。[Duolingo path changes](https://www.cnet.com/tech/services-and-software/8-changes-duolingo-made-for-easier-language-learning-in-2022/)
- **Godot Worldmap Builder / 常见关卡选择** 把节点、连线、锁定状态和当前节点做成可复用的地图组件。[godot-worldmap-builder](https://github.com/don-tnowe/godot-worldmap-builder)

本项目只借鉴“区域化场景 + 蜿蜒路径 + 节点状态 + 角色位置”的交互模式；地图、角色、怪物、树木、山脉、水晶等全部为原创 SVG/CSS 绘制，不复制 Prodigy 或任何竞品素材。

## 2. 地图结构

```text
数境世界地图（1200 × 820 逻辑坐标，桌面整图 / 移动端横向滑动）
├─ 图形峰林（geometry）     左上：雪山、岩峰、暖金色
├─ 数据浮岛（data）         右上：浮空岛、青色云海
├─ 数之草原（numbers）      左下：草地、森林、小屋
├─ 分数水晶湾（fractions）  右下：紫色水晶、海湾
├─ 蜿蜒小径：四段区域路径相连，节点落在路径上
├─ 12 个关卡节点：3 关 × 4 领域
├─ 当前关卡：勇者头像 + “你在这里”气泡
└─ 图例：已通关 / 当前关卡 / 未解锁 / 四大领域独立解锁
```

- 关卡节点显示怪物头像、1–3 星、短标签；悬停/键盘聚焦显示完整知识点和怪物名。
- 锁定节点灰化并禁用；当前节点青色脉冲；已通关节点金色边框和勾选。
- 四个领域独立解锁，路径是导航装饰，不表示必须跨领域顺序。
- 保留年级切换、星星总数、金币/等级、未完成战斗的“继续战斗”横幅。

## 3. 响应式与可访问性

- 桌面 1440 / 1024 / 768：整图适配容器宽度，节点缩放；地图内部没有横向溢出。
- 移动端 390 / 320：地图保持 940px 最小绘制宽度，外层 `.worldmap-shell` 内部横向滑动，文档本身不产生横向溢出；显示“左右滑动查看整张地图”提示。
- 所有节点是原生 `<button>`，支持 Tab 聚焦、`aria-label` 描述关卡/怪物/星星/锁定原因；锁定节点 `disabled`。
- 当前关卡有文字“你在这里”，不只依赖颜色；状态另有图标和星星。
- 减少动态效果时关闭节点脉冲/勇者浮动。

## 4. 验收

`node e2e/run.mjs` 检查地图：

- `.map-node` 数量为 12；
- `.map-region-label` 数量为 4；
- 存在 `.worldmap-trail-line` 与 `.map-hero`；
- 点击节点进入答题战斗；
- 1440 / 1024 / 390 下文档无横向溢出；移动端地图容器可内部横向滚动。

视觉对比见 [`docs/screenshots/world-map`](screenshots/world-map)。

# 架构与数据模型（P0 MVP）

## 1. 形态

```text
浏览器（学生/家长）                    浏览器（教研/运营）
  index.html + src/ui/*                  admin.html + src/admin/*
        │  HTTPS/JSON                         │  HTTPS/JSON
        └──────────────┬──────────────────────┘
                       ▼
              Node.js HTTP 服务（server/index.ts）
        路由 / RBAC / 静态资源 / SPA fallback / 安全头
                       │
       ┌───────────────┼────────────────────┐
       ▼               ▼                    ▼
  业务模块（modules）  判题/内容引擎      SQLite（node:sqlite）
  auth/family/quiz    judge/seed        data/mathrealms.sqlite
  curriculum/admin    content generator  WAL + 外键
  imports/ai
```

需求文档推荐 Phaser 3 + React + NestJS + FastAPI + PostgreSQL。本 P0 演示为了让单仓库在单机零构建运行，采用：

- 前端：原生 ES Modules + 既有 DOM/CSS/SVG 动效（战斗场景由 DOM/CSS 动画与 SVG 角色构成，预留 Canvas 迁移位）；
- 后端：Node 24 原生 TypeScript 直跑 + 内置 `node:sqlite`；
- 外部服务：全部以模块接口或本地模板实现，不依赖网络。

服务端分层、服务端权威、RBAC、审计、幂等、数据模型和页面清单仍按文档保留。迁移到 Phaser/React/NestJS 时，`/api/v1` 契约和 SQLite/PostgreSQL 表结构可直接复用。

## 2. 请求生命周期

1. 浏览器同源请求 `/api/v1/...`；静态资源由同一服务提供，避免 CORS。
2. `server/index.ts` 解析 URL、读取 JSON（12 MB 上限）、按路由表匹配。
3. 需要鉴权的路由解析 `Authorization: Bearer <token>`，校验 HMAC 签名和过期时间，再按角色做 RBAC。
4. 业务模块执行参数校验（`HttpError`）、SQL（全部参数化）和事务。
5. 统一返回 `{ code, message, details, requestId }` 错误结构；成功返回业务对象；204 用于退出/放弃。
6. 修改类操作写 `audit_logs`；超过 500ms 的请求打印带 `requestId` 的 JSON 日志。

## 3. 后端模块

| 文件 | 职责 |
| --- | --- |
| `server/lib/http.ts` | 路由编译/匹配、JSON 读取、错误类型、参数校验 |
| `server/lib/db.ts` | SQLite 打开、建表、事务、JSON 辅助 |
| `server/lib/auth.ts` | scrypt 密码、HMAC 令牌、RBAC、限流、审计 |
| `server/lib/judge.ts` | 单选/多选/判断/数字/分数/文本判题，数值与等价答案 |
| `server/lib/types.ts` | 双语内容、题型、答案、等级曲线、四大领域与怪物 |
| `server/seed/*` | 72 个知识点、约 1300 道种子题、演示账号与演示学习记录 |
| `server/modules/auth.ts` | 注册/登录/刷新/同意/创建孩子/绑定/解绑 |
| `server/modules/family.ts` | 家长报告、使用设置、导出、删除申请 |
| `server/modules/curriculum.ts` | 知识树、存档、设置、成长/背包 |
| `server/modules/quiz.ts` | 创建会话、抽题、提交、提示、下一题、结算、错题 |
| `server/modules/admin.ts` | 题目 CRUD/版本/发布、知识树 CRUD、看板、账号、审计、配置 |
| `server/modules/imports.ts` | XLSX/CSV 解析、校验、预览、批次、入库、回滚、模板 |
| `server/modules/ai.ts` | 生成任务、离线 provider、结构/数学/重复校验、审核发布 |

## 4. 核心数据表

| 域 | 表 |
| --- | --- |
| 账号与关系 | `users`、`profiles`、`family_links` |
| 课程与题库 | `knowledge_points`、`questions`、`question_versions`、`question_stats` |
| 导入/AI | `import_batches`、`ai_jobs`、`ai_items` |
| 学习与答题 | `quiz_sessions`、`session_questions`、`mastery_records`、`mistakes` |
| 游戏与奖励 | `game_saves`、`character_saves`、`currency_accounts`、`currency_transactions`、`reward_records`、`stage_results` |
| 运营与审计 | `audit_logs`、`configs` |

关键约束：

- `questions.code` 唯一；`question_versions(question_id, version)` 唯一；答题会话引用 `version_id` 并保存 `content_json`/`answer_json` 快照，题目后续修改不影响历史记录。
- `reward_records.idempotency_key` 唯一，结算事务内写 `currency_transactions`，同一会话重复结算不重复发奖。
- `currency_transactions.idempotency_key` 唯一；金币/星星账户余额在事务内更新。
- `family_links(parent_id, child_id)` 唯一，解绑为 `revoked` 保留审计。
- 题目、批次、AI 任务均带状态机；学生端只查询 `questions.status = 'PUBLISHED'`。

## 5. 判题与奖励规则

- 正确答案只在 `session_questions.answer_json` 中，取题接口（`GET /quiz-sessions/:id`、`next-question`）不返回。
- 答对：伤害 `22 + min(combo, 3) × 6 + 角色连击加成 + 角色固定加成`（默认 22/28/34/40）；答错：勇者受到 `max(8, 20 - 角色反击减免)`，连击中断。
- 角色：每名学生有 `character_saves`（独立 XP/等级/选中），战斗会话创建时固定 `characterId`；关卡难度 1/2/3 映射绝招 Tier 1/2/3，角色等级 3/5 解锁进阶/终极服饰与绝招。
- 结算：怪物 HP ≤ 0，或全部题目答完且正确率 ≥ 60% 且勇者存活 → 胜利；勇者 HP ≤ 0 → 失败。
- 星星：全对 3 星；正确率 ≥ 80% 2 星；胜利至少 1 星；失败 0 星。
- 经验：`正确数 × 12 + 胜利 20 + 星星 × 5`；金币：`正确数 × 6 + 星星 × 5`（失败按正确数少量发放）。
- 掌握度：`round(old × 0.7 + (正确 ? 100 : 0) × 0.3)`，0–100；每次作答更新。
- 错题：答错 upsert 到 `mistakes`，答对同题标记 `resolved = 1`；错题复习会优先带出原题并混入同知识点变式题。
- 关卡解锁：同领域前一关 `best_stars ≥ 1`；每关最多 3 星。

## 6. 导入与 AI

### 导入

- XLSX 四个 Sheet：`knowledge_points`、`questions`、`question_options`、`question_answers`，外加 `import_guide`。
- CSV 单表：题目行，支持 `option_a…option_d`、`correct_option`、`answer_value` 列。
- 预览阶段只解析/校验，不写题库；确认后事务内创建知识点和题目（默认 `DRAFT`），记录 `batch_id`。
- 错误行不阻塞有效行；回滚时被会话/错题引用的题目改为 `ARCHIVED`，未引用的物理删除。

### AI

- 任务字段：知识点、题型、难度、数量（1–5）。
- 离线 provider 复用数学题生成器，以任务时间派生 variant seed，生成新数字组合。
- 校验：JSON 结构、答案可解析、与题库题干相似提示；结果全部为 `DRAFT`。
- 审核：通过 → 创建 `PUBLISHED` 题目（source=`AI`）；驳回 → 记录理由。任务保存 provider/model/promptVersion/token/成本/原始结果。

## 7. 前端状态

`src/ui/app.js` 维护 `app` 单一状态树：用户/家庭、存档、地图、当前会话、题目、反馈、结果、错题、成长、家长报告、设置、忙碌标记。所有服务端调用经 `src/ui/api.js`；401 清空令牌回登录。`?debug` 暴露 `window.__mathrealms` 供 E2E 检查。

`src/admin/admin.js` 独立状态树：用户、当前视图、看板、题库筛选、导入预览、AI 任务、审计、配置、账号。后台与学生端共享同一套 `/api/v1` 和令牌（同一 `localStorage` 键 `mathrealms.token`）。

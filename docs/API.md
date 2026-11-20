# API 清单（/api/v1）

统一约定：

- JSON；`Content-Type: application/json`；UTF-8。
- 鉴权：`Authorization: Bearer <token>`（HMAC-SHA256，12 小时）。
- 错误：`{ "code": "...", "message": "...", "details": ..., "requestId": "..." }`，HTTP 状态码语义化。
- 写操作幂等：答题按 `(session, seq)`、结算按会话、货币按 `idempotency_key`。
- 角色：`student` / `parent` / `admin`。

## 公共

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/health` | 公开 | 健康检查 |
| GET | `/auth/demo` | 公开 | 演示账号提示 |
| POST | `/auth/register` | 公开 | 注册学生/家长；学生需 `consent=true` |
| POST | `/auth/login` | 公开 | 登录，返回 Token |
| POST | `/auth/refresh` | 登录 | 刷新 Token |
| POST | `/auth/logout` | 登录 | 204；无状态令牌 |
| GET | `/me` | 登录 | 用户、家庭、存档摘要 |
| POST | `/me/consent` | 学生 | 记录监护人同意 |

示例：

```http
POST /api/v1/auth/login
{ "username": "xiaoyu", "password": "demo1234" }

200 { "token": "...", "user": { "id": "...", "role": "student", "profile": {...}, "save": {...} }, "family": {...} }
```

## 课程 / 游戏

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/curriculum/tree?grade=4` | 登录 | 学科、单元、知识点树 |
| GET | `/game/save` | 学生 | 存档、地图、设置、未完成会话 |
| PUT | `/game/save` | 学生 | 更新设置（语言/声音/字号/对比度/动效） |
| PUT | `/game/grade` | 学生 | 切换年级 |
| GET | `/game/map?grade=4` | 学生 | 领域/关卡/星星/解锁状态 |
| GET | `/inventory` | 学生 | 余额、掌握度、答题统计、成就、背包 |
| GET | `/announcement` | 公开 | 学生端公告 |

## 家庭 / 家长

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/family` | 登录 | 家长：孩子列表；学生：已绑定家长/家庭码 |
| POST | `/family/bind` | 家长 | `{ inviteCode }` 绑定 |
| POST | `/family/children` | 家长 | `{ nickname, grade }` 创建孩子账号并返回一次性密码 |
| POST | `/family/unbind` | 家长 | `{ childId }` 解绑 |
| GET | `/parent/children/:id/report?days=7` | 家长 | 今日/周期/累计、周图、掌握、错题、通关、设置 |
| PUT | `/parent/children/:id/controls` | 家长 | 每日分钟、时段、提醒、消费审批 |
| GET | `/parent/children/:id/export` | 家长 | JSON 数据导出 |
| POST | `/parent/children/:id/deletion-request` | 家长 | 删除申请（写审计） |

## 答题

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/quiz-sessions` | 学生 | `{kind:"STAGE",stageKey}` 或 `{kind:"REVIEW",mistakeId}` / `{kind:"PRACTICE",knowledgeCode}` |
| GET | `/quiz-sessions/:id` | 学生 | 会话 + 当前题（无答案）+ 已答反馈 |
| GET | `/quiz-sessions/:id/next-question` | 学生 | 推进到下一题；返回 `{finished}` 时去结算 |
| POST | `/quiz-sessions/:id/answers` | 学生 | `{seq,answer,timeMs}`；返回判题、战斗动作、解析、掌握度 |
| POST | `/quiz-sessions/:id/hints` | 学生 | `{seq}`；返回下一条提示 |
| GET | `/quiz-sessions/:id/result` | 学生 | 结算（幂等）；返回奖励、下一关、地图 |
| POST | `/quiz-sessions/:id/abandon` | 学生 | 放弃 |
| GET | `/mistakes` | 学生 | 错题列表，支持 `resolved=0/1`、`knowledgeCode` |
| POST | `/mistakes/:id/review` | 学生 | 创建复习会话 |
| POST | `/mistakes/:id/resolve` | 学生 | 标记掌握 |

答案提交示例：

```json
{ "seq": 0, "answer": { "optionKey": "B" }, "timeMs": 8500 }
{ "seq": 1, "answer": { "value": "3/4" }, "timeMs": 12000 }
{ "seq": 2, "answer": { "optionKeys": ["A", "C"] }, "timeMs": 9000 }
{ "seq": 3, "answer": { "value": true }, "timeMs": 4000 }
```

## 后台（admin）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/admin/dashboard` | 指标与最近批次 |
| GET | `/admin/questions?status=&type=&grade=&knowledgeCode=&search=&limit=&offset=` | 题库列表 |
| GET | `/admin/questions/:id` | 题目详情与版本 |
| POST | `/admin/questions` | 创建草稿 |
| PUT | `/admin/questions/:id` | 编辑并生成新版本 |
| POST | `/admin/questions/:id/status` | `{action:"publish"\|"unpublish"\|"review"\|"reject"}` |
| GET/POST | `/admin/knowledge-points` | 知识树查询/新增 |
| PUT | `/admin/knowledge-points/:code` | 编辑名称/单元/难度/状态 |
| GET | `/admin/imports` | 批次列表 |
| POST | `/admin/imports/preview` | `{filename,base64}` 或 `{filename,text}` |
| GET | `/admin/imports/:id` | 预览/状态/错误 |
| POST | `/admin/imports/:id/commit` | 有效行入库为草稿 |
| POST | `/admin/imports/:id/rollback` | 回滚批次 |
| GET | `/admin/imports/template.xlsx` | 下载 XLSX 模板 |
| GET | `/admin/imports/template.csv` | 下载 CSV 模板 |
| GET/POST | `/admin/ai/jobs` | 任务列表/创建 |
| GET | `/admin/ai/jobs/:id` | 任务与草稿 |
| POST | `/admin/ai/items/:id/review` | `{action:"approve"\|"reject",reason?}` |
| GET | `/admin/users` | 账号列表 |
| GET | `/admin/audit-logs?action=&objectType=&limit=` | 审计日志 |
| GET | `/admin/configs` | 配置 |
| PUT | `/admin/configs/:key` | `{value}` 更新公告/开关 |

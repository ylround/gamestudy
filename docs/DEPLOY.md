# 部署与运维（参考）

> 本文是 P0 演示的单机部署模板。生产上线前请完成域名/HTTPS/备案、数据库托管与备份、密钥管理、监控告警和合规评估。

## 1. 本地 / 演示

```bash
npm install
npm start                 # 0.0.0.0:8787
# 或
PORT=9000 MATHREALMS_DB=/data/mathrealms.sqlite MATHREALMS_SECRET=... npm start
```

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | HTTP 端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `MATHREALMS_DB` | `data/mathrealms.sqlite` | SQLite 路径；目录会自动创建 |
| `MATHREALMS_SECRET` | 开发默认值 | **生产必须设置**，用于令牌签名 |

## 2. Docker

```bash
docker build -f deploy/Dockerfile -t mathrealms-p0 .
docker run --rm -p 8787:8787 -v "$PWD/data:/app/data" \
  -e MATHREALMS_SECRET='replace-with-a-long-random-secret' mathrealms-p0
```

`deploy/docker-compose.yml` 提供单机示例（应用 + Nginx）。生产建议把 SQLite 换成云 PostgreSQL（迁移表结构见 `ARCHITECTURE.md`），并把对象存储/短信/模型密钥放入环境变量或密钥管理。

## 3. Nginx / HTTPS

`deploy/nginx.conf` 示例：80 跳转 443、反代 `/api/` 与静态资源、上传大小 12 MB、基础安全头。证书可用云托管或 certbot。上线前确认 ICP 备案、域名和证书。

## 4. 备份与回滚

SQLite WAL 模式下的安全备份：

```bash
sqlite3 data/mathrealms.sqlite ".backup 'backup-$(date +%F).sqlite'"
```

或停机复制 `mathrealms.sqlite`。恢复：停止服务 → 替换数据库 → 启动。建议每日备份并保留 7–30 天，定期演练恢复。

应用回滚：保留上一版镜像/commit，Docker 用 `docker compose up -d` 指定旧镜像；数据库迁移目前为幂等建表，回滚前先备份。

## 5. 日志与监控

- 服务端对超过 500ms 的请求输出 JSON 日志：`requestId`、method、path、status、ms。
- 接入云日志/采集器，按 `requestId` 关联前端错误。
- 建议告警：5xx 比例、登录失败率、导入失败率、AI 任务失败/积压、数据库磁盘、备份失败。
- 前端可接入 Sentry 等（注意儿童数据最小化和第三方 SDK 清单）。

## 6. 环境分离

开发 / 测试 / 生产至少三套环境，使用不同数据库、密钥和域名；演示种子账号（`xiaoyu`/`mama`/`admin`）不得进入生产。生产首次启动可通过 `MATHREALMS_SEED_DEMO=0`（需在代码中加开关）或导入正式题库后停用演示账号；当前演示版本默认写入种子数据，部署正式环境前应删除演示账号并替换题库。

## 7. 上线检查清单

- [ ] `MATHREALMS_SECRET` 已更换为强随机值
- [ ] 演示账号已删除/改密，管理员使用个人账号
- [ ] HTTPS、ICP/教育 App/游戏分类按专业意见处理
- [ ] 数据库备份与恢复演练
- [ ] 日志/错误监控/告警接入
- [ ] 导入/AI/题库审核流程与教研确认
- [ ] 隐私政策、监护人同意、第三方 SDK 清单、注销/导出入口
- [ ] 班级并发/弱网/平板兼容测试

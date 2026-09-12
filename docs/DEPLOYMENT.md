# AtomForge v0.1.0 部署与维护

## 架构与前置条件

公网 HTTPS → Caddy → FastAPI（同时提供前端静态资源）→ SQLite 持久化卷。FastAPI 通过内部网络调用 runner；runner 不暴露公网端口，不获取模型密钥，不挂载 Docker socket。

适用 Linux x86_64、Docker Engine 与 Compose v2 或更新版。建议至少 2 核 CPU、4 GB 内存和 20 GB 可用磁盘；这是本项目容器资源预算，不是性能承诺。首次镜像构建还需空间下载 Node、Python 依赖和 Chromium。

域名 A 记录须指向服务器，安全组和防火墙允许 TCP 80/443；SSH 端口按自身管理策略开放。已有站点占用 80/443 时，先整合现有反向代理，不能直接覆盖配置或停止旧站。

使用 Cloudflare 时先确认 DNS 记录的源站 IP，SSL/TLS 使用 Full (strict)。证书签发遇到代理影响时，可暂用仅 DNS 完成签发再恢复代理。不要把 SSL 设成 Flexible，否则可能产生跳转循环。不要缓存 `/api/*`、登录响应或用户私有内容。

## 首次部署

```bash
git clone https://github.com/Vanity-C/AtomForge.git
cd AtomForge
git checkout v0.1.0
cp .env.docker.example .env.docker
cp .env.production.example .env.production
chmod 600 .env.docker .env.production
```

在服务器编辑 `.env.docker`，设置 `APP_AI_KEY`。不要将密钥提交 Git 或填写到前端配置。编辑 `.env.production`，设置 `ATOMFORGE_DOMAIN` 为实际域名（不带协议和路径）。然后运行：

```bash
bash deploy/start.sh
```

生产配置单独使用 `compose.production.yaml`；不要与本地 `compose.yaml` 混用，以免误操作数据卷。默认生产项目名为 `atomforge-production`，应用、runner 和 HTTPS 代理均自动重启。

若主机曾使用 `podman-docker`，安装 Docker Engine 后还应检查 `DOCKER_HOST` 是否仍指向 Podman socket。确认本机 Docker Engine 已启动后，在当前维护终端执行 `export DOCKER_HOST=unix:///var/run/docker.sock`，再运行上述脚本；保留原 Podman 数据和其他服务。

Caddy 的证书自动签发/续期依赖正确解析、开放端口与持久化证书目录，见 [Caddy 官方说明](https://caddyserver.com/docs/automatic-https)。Compose 单机部署方式参见 [Docker 官方说明](https://docs.docker.com/compose/how-tos/production/)。

## 小内存服务器

1 GB 内存实例只适合低并发评审，生产配置默认最多同时运行 1 个工作台生成任务。可在 `.env.production` 设置 `APP_MEMORY_LIMIT=384m`、`APP_SWAP_LIMIT=768m`、`RUNNER_MEMORY_LIMIT=768m`、`RUNNER_SWAP_LIMIT=1536m`，并为宿主机配置至少 2 GB swap。swap 能降低内存不足时被终止的概率，但不能替代物理内存或保证性能；不要在这样的服务器上执行镜像构建。

在内存充足的 Linux x86_64 主机或 Docker Desktop 上构建，然后传输镜像文件：

```bash
docker build -t atomforge:0.1.0 .
docker build -t atomforge-runner:0.1.0 -f app/runner/Dockerfile .
docker save -o atomforge-v0.1.0-images.tar atomforge:0.1.0 atomforge-runner:0.1.0
# 将镜像文件安全传输到服务器，然后在服务器执行：
docker load -i atomforge-v0.1.0-images.tar
ATOMFORGE_SKIP_BUILD=1 bash deploy/start.sh
```

## 发布检查

1. 公网访问首页、`/dashboard`、`/account` 刷新和 `/demo-guide.html`，确认没有浏览器证书警告。
2. 使用新账号完成注册与用户名/邮箱登录；不要在提交文档公开管理员密码。
3. 创建工程师或团队项目，生成一个小型应用，确认出现真实源码与可操作预览。
4. 刷新后验证项目、会话、版本仍保留；验证停止、失败草稿和重试入口。
5. 发布应用得到 `/apps/<slug>`，在未登录页面打开；分享和发布是不同入口。
6. 确认 GitHub 仓库与说明文档可在未登录状态读取。

## 日常运行

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --tail=80 app
docker compose --env-file .env.production -f compose.production.yaml logs --tail=80 proxy
```

数据库位于应用容器 `/data/atomforge.db`，签名和加密用密钥位于 `/data/jwt-secret`；宿主 Docker 卷为 `atomforge-production_data`。两者必须成套备份。不要用 `down -v` 日常停止。

```bash
bash deploy/backup.sh
```

备份使用 SQLite online backup API，并执行完整性检查，输出到私有 `backups/`。下载到受控异地位置；该目录不进入 Git。`.env.docker`、`.env.production` 另行安全备份。可由服务器自身的调度系统每天执行备份脚本，保留周期根据磁盘和评审周期设置；脚本本身不删除历史备份。

## 升级与回退

升级前备份数据库和密钥，记录当前 Git 提交与镜像标签；切换新版本后重新运行启动脚本。此 Demo 使用单 worker 和加法迁移，重启会中断执行中的模型调用，但保存的版本不丢失。不要在用户生成中直接更新容器。

应用代码版本可在工作台回滚并重新发布。平台部署回退则切回已验证的 Git 标签/镜像；如果后续迁移不向后兼容，先在隔离实例恢复备份验证，再切换流量。恢复数据库时停止应用写入，并同时恢复配套 `jwt-secret`，避免已有加密凭据不可读。

## 运行边界

评审账号可自助注册；生成会消耗服务端配置的模型额度。默认每小时 30 次实例生成请求，生产配置最多 1 个工作台生成任务、单项目一个活动任务；`AI_MAX_ACTIVE_RUNS` 可设置为 1–3。个人 token 预算是软预算，不能替代供应商余额控制。

当前是单机 Demo，不是多租户商业生产平台；尚未实现跨服务器队列、完整故障自动续跑、硬计费配额或每项目独立虚拟机。服务器/DNS 私有连接信息不写入公开源码。

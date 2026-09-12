# AtomForge

通过智能体团队把自然语言需求转化为可运行、可迭代、可发布的 React 应用。

第二版 v0.2.0：新增团队领导调度、智能体定制、Monaco 编辑器、GitHub / Gitee 登录与发布，以及 Netlify 部署。模型支持 DeepSeek 和本机 Codex 账号 GPT 接入，用量按项目汇总。详见 [第二版发布说明](docs/RELEASE_V0.2.0.md)和[模型接入与用量说明](docs/MODELS_V2.md)。

智能体可在账户菜单的「智能体管理」中定制：创建专属伙伴，编辑名字、头像、性格、职责和开场白，安排协作岗位，或恢复默认团队。详见 [智能体管理与协作](docs/AGENTS_V2.md)。

[在线体验](https://newlifezh.top/) · [Demo 说明](https://newlifezh.top/demo-guide.html) · [版本发布](https://github.com/Vanity-C/AtomForge/releases) · [部署文档](docs/DEPLOYMENT.md)

## 能体验什么

- 用户名或邮箱登录，个人资料与头像管理，每个账号独立保存项目。
- 工程师模式与团队模式；Atlas 负责需求沟通与任务调度，Milo、Luna、Ollie、Neo、Pip 分别负责产品、设计、架构、开发和测试。
- 必要时用选项卡确认需求，支持自定义答案、30 秒推荐默认值和暂停决策。
- 展开工具执行记录，查看角色交接、文件草稿、验证结果和完成摘要。
- 在右侧标签页查看预览、源码和工作看板，继续对话修改、回滚版本、导出 ZIP。
- 独立容器构建与 Chromium 交互测试；通过验证后提交版本，失败可保留草稿并重试。
- 发布独立应用链接；可配置生成应用的账号、数据集合和 AI 云服务。

角色是使用同一模型服务的不同任务职责，不宣称多个独立模型或开放式自主集群。GitHub 应用同步、Stripe 和联网研究需要另行配置，未计入第一版真实外部服务验收。

## Docker Compose 本地启动

安装 Docker Engine 或 Docker Desktop（Linux 容器），以及 Docker Compose。

```bash
cp .env.docker.example .env.docker
# 编辑 .env.docker，填写自己的 APP_AI_KEY。
docker compose up -d --build --wait
```

Windows PowerShell 可用 `Copy-Item .env.docker.example .env.docker`。不要覆盖已有配置。

打开 [本地首页](http://localhost:8080/)，注册自己的账号。模型密钥仅由后端使用。首次构建会下载依赖和 Chromium；已有项目与密钥保存在命名卷中。

```bash
docker compose ps
docker compose logs --tail=80 app
docker compose down         # 停止并保留数据
docker compose up -d --wait  # 使用现有镜像恢复
```

默认仅监听本机 `127.0.0.1:8080`。端口冲突可在根目录 `.env` 中设置 `ATOMFORGE_PORT=8081`。修改代码后重新带 `--build` 启动。不要使用 `down -v` 进行日常停止。

## Windows 源码开发启动

安装并启动 Docker Desktop（Linux 容器），运行 `./setup.ps1` 安装前后端依赖，再运行 `./start.ps1`。工作台默认位于 `http://127.0.0.1:15173`，可用 `./start.ps1 -Port 15174` 指定端口。后端使用 `app/backend/.env.local`。

启动脚本会先启动 `compose.local.yaml` 中的独立验证服务和本机网关，确认编译器、Chromium 与页面断言均正常后，再启动前后端。验证服务仍位于隔离网络；网关仅监听本机 `127.0.0.1:8001`，不影响 8080 上的完整 Docker 部署。`./status.ps1` 同时检查前端、后端、数据库和真实验证能力，`./stop.ps1` 停止本地开发服务并保留数据。

新任务在调用模型前检查验证服务。若执行途中验证连接中断，会保留代码、团队交接和测试步骤；恢复后点击「继续验收」直接复用草稿。只有验收发现实际应用问题才进入代码修复，通过全部检查后才保存正式版本。

## 独立服务器部署

生成应用现在支持 GitHub / Gitee 第三方登录与源码发布，以及 Netlify 公网部署。项目右上角进入“发布与部署”；平台 OAuth 配置、个人令牌、失败恢复和云服务限制见 [登录、发布与公网部署](docs/PUBLISHING_AND_DEPLOYMENT.md)。

使用独立的 `compose.production.yaml`，由 Caddy 提供 HTTPS。详见 [部署、备份与维护](docs/DEPLOYMENT.md)。生产数据卷与本地数据卷相互独立。

## 项目结构

```text
app/frontend/  React + TypeScript + Vite 工作台
app/backend/   FastAPI、SQLite、账号和生成编排
app/runner/    Node 构建与 Chromium 验证服务
deploy/        Caddy、启动和数据库备份脚本
docs/          Demo 说明、部署和发布验证记录
scripts/       数据库初始化与容器入口
```

工作台、会话、源码和版本持久化在 SQLite。生成代码在 runner 的内部网络中构建和测试；浏览器预览使用沙箱。第一版采用单 worker，适合小规模评审，尚未实现分布式队列、完整自动续跑和商业级计费。

## 开发验证

```bash
# 在已安装后端开发依赖的环境中，从仓库根目录运行
python -m pytest app/backend/tests -q

cd app/frontend
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm lint
node --test scripts/test-*.mjs
pnpm build

# runner 检查需 Node 24、npm ci 和 Playwright Chromium
cd ../runner
npm test
```

后端测试使用临时 SQLite 和模拟模型，不会消费真实模型额度。真实服务器生成与浏览器验收另行记录在 [发布验证记录](docs/VALIDATION.md)。

## 交付说明

[第一版说明](docs/DEMO_V1.md) 记录实现思路、关键取舍、完成程度与后续优先级。公开仓库不包含模型密钥、服务器凭据、用户数据库和运行日志。项目是独立实现的学习 Demo，与 Atoms 官方无隶属关系。

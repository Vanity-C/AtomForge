# AtomForge

把自然语言需求变成可操作、可继续修改、可发布的 React 应用。

AtomForge 是独立实现的 AI 应用工作台：从需求拆解、角色交接、代码生成到浏览器验收和版本发布，提供可体验、可追踪的交付流程。当前交付版本 **v0.3.1**。

**[在线 Demo](https://newlifezh.top/) · [笔试说明](docs/SUBMISSION.md) · [公开在线说明](https://newlifezh.top/demo-guide.html) · [发布记录](https://github.com/Vanity-C/AtomForge/releases)**

## 评审入口

| 材料 | 地址与使用方式 |
| --- | --- |
| 已部署 Demo | [newlifezh.top](https://newlifezh.top/)，首页公开，创建项目需自助注册以隔离个人数据 |
| 笔试说明 | [实现思路、取舍、完成程度与后续优先级](docs/SUBMISSION.md)；亦有[无需登录的网页版](https://newlifezh.top/demo-guide.html) |
| GitHub 源码 | [Vanity-C/AtomForge](https://github.com/Vanity-C/AtomForge)，公开仓库 |
| 生成应用示例 | [今日清单](https://newlifezh.top/apps/G0jOQjc79B0Dcax7)，可直接操作 |

原笔试文档第 4 部分所需的三个链接，可从以上入口复制。公开的是源码、说明及 Demo 入口，用户项目和账号数据保持私有。可选的 AI 工具充值账单未附，不虚构费用。

## 五分钟体验

1. 打开 Demo 注册账号，进入工作台；支持用户名或邮箱登录。
2. 选择团队模式，输入：

   > 做一个每周习惯打卡应用：用户可以添加习惯，为本周每天切换打卡状态，显示每个习惯的周完成率与总进度，可删除习惯。使用 localStorage 保存并在刷新后恢复。界面用薄荷绿、七日网格、清楚的已完成状态，支持手机窄屏。

3. 查看 Atlas（领导）、Milo（产品）、Luna（设计）、Ollie（架构）、Neo（开发）、Pip（测试）的工作。专业角色直接交接，必要问题才请求用户决定。
4. 切换预览、文件和工作看板，查看代码、工具记录、负责人及验收证据。生成使用真实模型与浏览器测试，需要等待；可查看当前进度。
5. 添加习惯、切换打卡并刷新验证数据，继续对话修改或回滚版本。
6. 从“发布与部署”发布站内独立链接或导出 React 工程；GitHub/Gitee 源码发布及 Netlify 部署需要连接自己的第三方账号。

## 当前能力

- **项目工作台**：实际页面缩略图、项目缓存、预览/Monaco 源码/看板标签、版本回滚与 ZIP 导出。
- **账号管理**：资料与头像、修改密码及旧会话失效；GitHub、Gitee、Netlify 绑定与换绑流程。
- **可配置团队**：默认六角色，领导展示首位；多个团队、成员组合、智能体资料与职责编辑。
- **双层看板**：固定交付列“待办 → 就绪 → 进行中 → 评审中 → 验证中 → 待验收 → 完成”；领导调整优先级、WIP、SLA 和质量策略，保留原因与版本。
- **真实生成与迭代**：DeepSeek 或已配置 Codex 提供模型能力；精确局部补丁、草稿持久化、有限修复、先复验草稿再决定是否开发。
- **独立验收**：容器编译和 Chromium 交互；支持刷新及禁用状态断言，先区分测试错误与代码缺陷，未通过不保存正式版本。
- **交付集成**：站内发布、只读分享、GitHub/Gitee 发布、Netlify 部署与公网检查；可选应用账号、集合数据与 AI 云接口。

完整边界见[笔试说明](docs/SUBMISSION.md)，协作规则及模板见[团队工作流](docs/TEAM_WORKFLOW.md)。

## 架构与工程取舍

```text
React / TypeScript / Vite 工作台
              │ HTTPS
            Caddy
              │
FastAPI：身份、项目、任务编排、版本、模型调用、发布
       │                 │                 │
  SQLite 持久卷    DeepSeek / Codex     独立 runner 容器
                                     esbuild + Chromium
```

服务端保存任务和交接状态；生成源码经固定依赖白名单与真实浏览器检查后才成为版本。runner 不持有模型密钥或 Docker socket，测试拦截外部网络，预览使用沙箱。云接口测试替身不能代表真实支付或第三方服务验收。

当前采用单机 SQLite、单应用 worker 和串行专业工作包，降低部署成本并明确恢复边界。角色使用选定模型承担不同职责，不宣称多模型并行集群；提高 WIP 不会自动增加模型并发。上游独立专业签审、分布式队列和生产缺陷汇总仍是后续工作。

## Docker Compose 启动

需要 Docker Engine 或 Docker Desktop 的 Linux 容器，以及 Docker Compose。

```bash
git clone https://github.com/Vanity-C/AtomForge.git
cd AtomForge
cp .env.docker.example .env.docker
# 编辑配置，填入自己的模型密钥；不要覆盖已有配置
docker compose up -d --build --wait
```

Windows PowerShell 使用 `Copy-Item .env.docker.example .env.docker`。打开 [localhost:8080](http://localhost:8080/) 注册账号。首次构建下载依赖和 Chromium；项目与密钥保存在数据卷中。

```bash
docker compose ps
docker compose logs --tail=80 app
docker compose down         # 停止并保留数据卷
docker compose up -d --wait  # 恢复
```

默认仅监听本机；端口冲突时在根目录 `.env` 设置 `ATOMFORGE_PORT=8081`。日常停止不要使用 `down -v`。

## 源码开发与生产部署

Windows 安装并启动 Docker Desktop，运行 `./setup.ps1`，再运行 `./start.ps1`。默认工作台 `http://127.0.0.1:15173`，后端读取 `app/backend/.env.local`。脚本会检查独立验证服务的实际编译和浏览器能力。

独立服务器使用 `compose.production.yaml` 和 Caddy HTTPS。低内存服务器在开发机器构建镜像后传输。账号会话升级采用增量数据库兼容，部署前备份数据库与配套密钥。详见[部署、备份与恢复](docs/DEPLOYMENT.md)及[第三方登录与发布配置](docs/PUBLISHING_AND_DEPLOYMENT.md)。

```text
app/frontend/  工作台与交互
app/backend/   身份、项目、生成编排、版本与发布
app/runner/    构建和隔离浏览器测试
deploy/        HTTPS、启动、备份脚本
docs/          交付说明、设计、部署和验证记录
scripts/       数据库初始化、容器入口、文档生成
```

## 验证

```bash
python -m pytest app/backend/tests -q
cd app/frontend
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm lint
node --test scripts/test-*.mjs
pnpm build
cd ../runner
npm ci
npx playwright install chromium
npm test
```

后端回归使用临时数据库和模拟模型；runner 实际执行 Chromium；真实模型案例与生产检查分开记录在[发布验证记录](docs/VALIDATION.md)。单个成功案例不代表所有需求的成功率。

## 文档导航

- [笔试说明：实现、取舍、完成度、扩展计划](docs/SUBMISSION.md)
- [交付看板、战略策略、门禁和模板](docs/TEAM_WORKFLOW.md)
- [v0.3.1 更新说明](docs/RELEASE_V0.3.1.md)
- [v0.3.0 更新说明](docs/RELEASE_V0.3.0.md)
- [模型接入与用量](docs/MODELS_V2.md)
- [发布验证记录](docs/VALIDATION.md)
- [历史 v0.1.0](docs/DEMO_V1.md)、[历史 v0.2.0](docs/RELEASE_V0.2.0.md)

公开仓库不包含生产凭据、模型令牌、用户数据库和运行日志。项目为独立实现，与 Atoms 官方无隶属关系。

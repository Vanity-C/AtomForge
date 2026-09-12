# AtomForge 第二版 · v0.2.0

## 功能

- 工作室以对话创建项目，项目、灵感和提示收纳至可折叠侧边栏。
- 默认团队领导 Atlas 接收需求、拆解任务、分配成员并根据反馈调整计划。
- 智能体支持定制头像、性格与职责，并可恢复默认设置；工作看板展示阶段、负责人及检查进度。
- 模型列表按供应商发现可用模型，用量按项目展示并支持展开详情。
- 文件编辑器使用 Monaco，支持多标签、关闭文件与未保存修改确认。
- GitHub / Gitee OAuth 登录及源码发布；GitHub 绑定冲突支持用户确认后转移。
- Netlify 公网部署支持构建检查、草稿验证、上线检查和失败恢复；需配置对应平台授权。
- 改善依赖安装中断、构建验证恢复以及生成失败后的反馈。

## 生产配置与升级

生产域名为 `https://newlifezh.top`，OAuth 凭据仅存放于服务器 `.env.docker`，不进入镜像或源码。回调地址：

- GitHub：`https://newlifezh.top/api/v1/af-auth/oauth/github/callback`
- Gitee：`https://newlifezh.top/api/v1/af-auth/oauth/gitee/callback`

升级前运行 `deploy/backup.sh` 并备份环境配置，保留旧镜像。容器启动执行加法迁移，保持账号、项目及版本归属；升级时应确认没有进行中的生成或发布任务。保留原数据卷和 `/data/jwt-secret`，禁止删除生产数据卷。

生产服务器使用预先构建的 `atomforge:0.2.0` 和 `atomforge-runner:0.2.0`，设置 `ATOMFORGE_VERSION=0.2.0` 后以 `ATOMFORGE_SKIP_BUILD=1 bash deploy/start.sh` 启动。回退时恢复旧镜像版本和对应配置，兼容性确认后使用原数据卷。

GPT / Codex 账号额度依赖后端主机自己的 Codex CLI 登录状态，不会从开发电脑复制个人登录凭据到生产服务器。未配置的模型与外部平台应明确显示不可用。

## 发布验收 · 2026-09-12

- 生产应用与 runner 均已切换至 `0.2.0`，Docker 健康检查通过；公网首页、登录页、健康与数据库健康接口正常。
- 升级前完成 SQLite 在线备份、完整性检查及环境配置备份；升级后原有 2 个账号、4 个项目保留，数据库完整性检查通过，原模型配置与登录签名密钥一致。
- GitHub 使用独立的 AtomForge Production OAuth 应用；Gitee 的 AtomForge 应用同时保留本地与生产回调。
- 已在真实浏览器中分别完成 GitHub、Gitee 的生产绑定、退出与第三方重新登录，均返回原生产账号，未创建重复账号。
- 生产 DeepSeek 模型发现成功，两个配置模型可用；生产 Codex CLI 尚未安装及登录，GPT 当前不可用。Netlify 生产 OAuth 凭据尚未配置。
- 发布前验证：后端 107 项、前端脚本 28 项、隔离 runner 8 项测试通过；TypeScript、lint、生产镜像构建及镜像健康检查通过。

本次未新建对外发布仓库或 Netlify 站点；OAuth 登录验收不代表所有第三方交付场景均已完成生产验收。

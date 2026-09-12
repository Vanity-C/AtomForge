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

发布验收结果另行记录，功能列表不代表外部平台已经全部完成生产验收。

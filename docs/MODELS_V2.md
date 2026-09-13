# AtomForge V2：模型与项目用量

## 使用方式

在「生成设置」选择模型并保存。DeepSeek 继续使用后端已有的 `APP_AI_BASE_URL` 和 `APP_AI_KEY`，无需重新提供密钥。列表从 DeepSeek API 同步，并为已知模型显示完整版本名称：DeepSeek V4.1 Flash、DeepSeek V4 Pro · 0813。API ID 与展示名称分开保存；上游新增的 DeepSeek 模型也会显示。

GPT 使用**后端所在电脑**已登录的 Codex CLI。安装官方 CLI 后运行 `codex login`，选择 ChatGPT 账号登录，再刷新生成设置。AtomForge 通过官方 app-server 的 `account/read` 与 `model/list` 检测账号和模型，通过 `codex exec --json` 调用模型。只接受 ChatGPT 登录，不使用 OpenAI API Key，也不读取、复制或上传 Codex OAuth 令牌。

CLI 必须支持 `exec --ignore-user-config`、`--ephemeral` 和 app-server 模型发现。Windows 可自动发现 npm 或 PATH 中的原生可执行文件；必要时设置 `ATOMFORGE_CODEX_BIN` 为 `codex.exe` 的绝对路径。Linux 使用 PATH 中的 `codex`。模型发现结果缓存 60 秒。Codex 生成采用 CLI 默认推理设置，设置页的创造性参数仅对 DeepSeek 生效。

Windows 系统代理会传给 CLI；显式设置的 `HTTP_PROXY`、`HTTPS_PROXY` 优先。模型调用在临时目录中运行，使用只读沙箱并关闭 shell、应用、插件、hooks、浏览器和多智能体能力。生成文件继续由 AtomForge 原有的增量补丁、runner 验证及版本提交流程处理。

Dockerfile 固定安装 Codex CLI `0.153.0`，运行镜像使用 `/usr/local/bin/codex` 原生程序。生产容器设置 `CODEX_HOME=/data/codex`，登录状态保存在已有 `data` 卷；启动脚本以应用用户创建目录并设为 `0700`，升级旧数据卷时也会创建。重建镜像或重建容器会保留卷中的登录状态；Docker/远程服务器仍不会自动获得你电脑上的 Codex 登录。

首次使用时，先在个人 ChatGPT 账号的安全设置启用设备码登录；团队工作区由管理员在工作区权限中启用。新镜像启动后，在服务器的仓库目录运行：

```bash
docker compose --env-file .env.production -f compose.production.yaml exec app codex login --device-auth
docker compose --env-file .env.production -f compose.production.yaml exec app codex login status
```

第一条命令会给出链接和一次性代码，用自己的浏览器登录 ChatGPT 并完成授权，再执行第二条确认登录方式为 ChatGPT。随后在 AtomForge「生成设置」刷新模型列表、选择 GPT 模型并保存；列表缓存 60 秒，刚登录后仍显示不可用时，等待缓存到期再刷新。详细升级步骤见 [部署与维护](DEPLOYMENT.md#接入-codex-账号额度)。只有完成服务器登录并验证生成后，才算该生产实例已接通；本机或隔离容器检查不能替代生产验证。

该接入使用服务器登录账号的 Codex 额度，实例中的所有 AtomForge 用户选择 GPT 时都会共用该账号；当前没有按网站用户绑定各自 Codex 账号。API Key 属于独立 API 计费，当前 GPT 接入不接受 API Key 登录。此方案用于受信任的个人部署；官方推荐自动化默认使用 API Key，并要求避免在不受信任或公开环境暴露 Codex 执行能力，见 [官方认证说明](https://learn.chatgpt.com/docs/auth) 与 [非交互调用说明](https://learn.chatgpt.com/docs/non-interactive-mode)。

不要把个人 Codex 凭据打包进镜像或公开仓库。`deploy/backup.sh` 只备份数据库和配套 `jwt-secret`，不包含 `/data/codex`；在新数据卷恢复备份后，应重新执行设备码登录。

## 用量口径

- 设置页按项目显示输入、输出、合计 tokens 与调用次数，默认收起明细。
- 汇总涵盖当前 AtomForge 账号的全部已记录调用，不再受原有 500 条限制。
- 展开后加载模型、阶段、时间、输入和输出；每页 50 条，可继续加载。重试、自动修复和报告调用仍分别记录。
- 所有查询按当前账号隔离；已删除项目保留用量，名称显示为「已删除项目」。
- Codex CLI 返回的输入包含其运行上下文，可能大于业务提示词。tokens 不等同于 Codex 账号额度百分比，也不能换算成订阅剩余次数。
- 本地月度 token 预算继续覆盖所有模型；GPT 订阅用量不套用 API 单价。DeepSeek 金额仍按用户填写的单价估算。
- 未返回 usage 的调用当前按零记录；进程取消或请求失败未收到用量时，无法还原上游已消费的 tokens。供应商用量可能高于本地记录。

## 验证

```powershell
.venv/Scripts/python.exe -m pytest app/backend/tests -q
cd app/frontend
pnpm exec tsc --noEmit
pnpm lint
node --test scripts/test-*.mjs
pnpm build
```

新增测试覆盖超过 500 条的项目汇总、明细游标分页、跨账号隔离、GPT 设置持久化、供应商匹配、GPT 独立路由和订阅用量计费口径。2026-09-12 已通过本机 ChatGPT 登录检测及 GPT-5.6-Luna 真实 JSON 调用，收到 6,127 输入、9 输出 tokens。

官方参考：[Codex app-server](https://developers.openai.com/codex/app-server)、[Codex 非交互调用](https://developers.openai.com/codex/noninteractive)、[DeepSeek 模型说明](https://api-docs.deepseek.com/quick_start/pricing/)。

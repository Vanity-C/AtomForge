# AtomForge V2：模型与项目用量

## 使用方式

在「生成设置」选择模型并保存。DeepSeek 继续使用后端已有的 `APP_AI_BASE_URL` 和 `APP_AI_KEY`，无需重新提供密钥。列表从 DeepSeek API 同步，并为已知模型显示完整版本名称：DeepSeek V4.1 Flash、DeepSeek V4 Pro · 0813。API ID 与展示名称分开保存；上游新增的 DeepSeek 模型也会显示。

GPT 使用**后端所在电脑**已登录的 Codex CLI。安装官方 CLI 后运行 `codex login`，选择 ChatGPT 账号登录，再刷新生成设置。AtomForge 通过官方 app-server 的 `account/read` 与 `model/list` 检测账号和模型，通过 `codex exec --json` 调用模型。只接受 ChatGPT 登录，不使用 OpenAI API Key，也不读取、复制或上传 Codex OAuth 令牌。

CLI 必须支持 `exec --ignore-user-config`、`--ephemeral` 和 app-server 模型发现。Windows 可自动发现 npm 或 PATH 中的原生可执行文件；必要时设置 `ATOMFORGE_CODEX_BIN` 为 `codex.exe` 的绝对路径。Linux 使用 PATH 中的 `codex`。模型发现结果缓存 60 秒。Codex 生成采用 CLI 默认推理设置，设置页的创造性参数仅对 DeepSeek 生效。

Windows 系统代理会传给 CLI；显式设置的 `HTTP_PROXY`、`HTTPS_PROXY` 优先。模型调用在临时目录中运行，使用只读沙箱并关闭 shell、应用、插件、hooks、浏览器和多智能体能力。生成文件继续由 AtomForge 原有的增量补丁、runner 验证及版本提交流程处理。

Docker/远程服务器不会自动获得宿主机的 Codex 登录。此版本已验证本机后端接入；容器没有 CLI 或 ChatGPT 登录时会明确显示不可用。不要把个人 Codex 凭据打包进镜像或公开仓库。

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

# 验证服务与大输出恢复

## 验证服务

runner 必须通过 Compose 的 `init: true` 启动，回收 Chromium 的孤儿子进程。
保留 `pids_limit: 256`、隔离网络、非 root 用户和现有 90 秒任务看门狗。
`/health` 提供 `processes.current/limit/pressure`；任务数达到上限的 85% 时停止接收新的浏览器任务，避免把剩余进程名额完全耗尽。

生产通过宿主机 systemd timer 每轮完成后 15 秒检查一次 runner。
持续 45 秒 unhealthy 或高进程压力才触发恢复；正常任务执行期间不因短暂压力重启。
宿主机从 Docker 状态和 cgroup 读取信息，不依赖在故障容器内启动新进程，也不向 runner 暴露 Docker socket。
仅选择 `atomforge-production` 的 runner，绝不重启 app/proxy，也不拉起手动停止的容器。
重启尝试间隔至少 120 秒，每 15 分钟最多 3 次，冷却和异常原因记录于 journal。
达到上限仍不健康时需要运维检查根因，不会通过无限重启掩盖故障。

Linux root 执行 `deploy/start.sh` 会安装/更新守护定时器；已有环境可单独执行：

```bash
bash deploy/install-runner-watchdog.sh
systemctl status atomforge-runner-watchdog.timer
journalctl -u atomforge-runner-watchdog.service --since '-30 min'
python3 /usr/local/lib/atomforge/runner-watchdog.py --dry-run
```

停止这项自动恢复：`systemctl disable --now atomforge-runner-watchdog.timer`。
监测状态位于 `/var/lib/atomforge-runner-watchdog/state.json`，不含账号密钥。

## 工程师输出

AtomForge 不再为领导、产品、设计、架构、工程师、测试及智能体咨询设置固定的阶段输出额度；工程师分批也不再使用 6,000 tokens 或 2,000–10,000 字符配额。
当前 DeepSeek Flash / V4 Pro 使用供应商支持的完整单次输出容量 393,216 tokens（384K），不是要求每次生成这么多内容。模型正常结束即可返回，按实际用量记录。
不能简单省略 max_tokens：DeepSeek 官方接口文档说明非思考模式省略时默认只有 8K。新增未知模型不猜测其容量；GPT/Codex 仍使用自身供应商能力，不注入 DeepSeek 参数。

DeepSeek 使用流式接收，不再因整个调用超过 180 秒就截断正在输出的内容。保留 180 秒无有效输出的超时、取消和连接清理；空心跳不续期。UI 定期更新接收状态，流缺少结束标记时不会将截断内容当成完整结果。
供应商单次上限仍然存在；确实达到它时，工程师把工作进一步拆为完整函数或模块继续生成，每次请求仍使用同样的供应商容量，不降低为平台自定 token 配额。

官方依据（核对日期 2026-09-15）：https://api-docs.deepseek.com/api/create-chat-completion/ 和 https://api-docs.deepseek.com/quick_start/pricing/ 。

每一批必须列出剩余工作，精确匹配当前文件并完整校验后，才同时保存草稿与 `code_checkpoint`。
网络中断、取消和后续失败不会删除已保存的批次。继续任务恢复该断点，不复用未完成的工程师交接作为“已完成实现”。
取消“24 批后终止”的限制：只要持续产出有效修改，自动接着实现剩余工作，不需要用户因批次数量点击继续。旧断点中的字符预算会在恢复时移除。
保留基于实际异常的保护：无进展的源码来回循环、连续无效补丁、供应商连续不能返回完整内容会保存断点并释放当前执行；强制停止、真实 QA 验收门禁和验证进程看门狗继续生效。它们不以已消耗的输出 tokens 或累计批次数为停止依据。
最后一批完成后仍执行完整构建、自测与团队的独立 QA 门禁，通过后才创建应用版本。
分批完成不代表质量验收通过；第三方模型长时间不可用、持续返回无效补丁仍可能使当前执行暂停，但保存的版本和已校验草稿不受影响。

局部补丁必须精确且唯一匹配。定位冲突时返回旧片段出现次数、替换片段是否已存在，以及当前草稿的邻近源码证据，最多在协议层修正3次；不模糊替换，也不把相同定位失败当作30轮应用测试。
独立QA每轮只收到本次候选源码和新的源码摘要，不再混入自身上一轮的缺陷结论或旧修复指令，避免已经修复的语句被反复要求替换。需求和验收标准仍完整保留。

## 回归检查

```bash
python -m pytest app/backend/tests/test_model_output.py app/backend/tests/test_code_batches.py app/backend/tests/test_resilience.py app/backend/tests/test_verification_recovery.py
python -m unittest discover -s deploy -p test_runner_watchdog.py
node --test app/runner/process-health.test.mjs app/runner/job-watchdog.test.mjs
```

Linux 隔离容器另外运行 `app/runner/process-lifecycle.test.mjs`，覆盖 24 轮真实浏览器创建、交互、关闭及僵尸检查。宿主机自动恢复须在独立测试容器注入 unhealthy 并验证恢复，不能在用户生产 runner 注入故障。

参考：Playwright 官方 Docker 指南关于 `--init` 与僵尸回收的建议；Docker 官方 restart policy 文档。健康检查和进程重启是不同机制，需要同时配置。

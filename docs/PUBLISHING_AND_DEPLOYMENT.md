# 第三方登录、源码发布与公网部署

## 开通 GitHub / Gitee 登录

如果登录页显示“未开通”，表示当前实例缺少平台应用凭据，不能通过个人访问令牌或 Codex 账号额度代替。登录与注册共用 OAuth 入口：首次授权创建账号，后续授权返回同一账号。

本地可在仓库根目录运行 `./configure-oauth.ps1 -Check` 检查配置状态（不会输出密钥）；运行 `./configure-oauth.ps1` 按提示输入 Client ID 和隐藏输入的 Client Secret，写入根目录 `.env.docker`，保留其他配置。脚本不会自动创建第三方应用，也不会重启正在执行任务的服务。

创建应用时使用以下资料：

| 字段 | GitHub | Gitee | Netlify |
| --- | --- | --- | --- |
| 应用名称 | AtomForge Local | AtomForge Local | AtomForge Local |
| 网站地址 | `http://127.0.0.1:8080` | `http://127.0.0.1:8080` | `http://127.0.0.1:8080`（若要求填写） |
| 回调地址 | `http://127.0.0.1:8080/api/v1/af-auth/oauth/github/callback` | `http://127.0.0.1:8080/api/v1/af-auth/oauth/gitee/callback` | `http://127.0.0.1:8080/api/v1/af-auth/oauth/netlify/callback` |

如果平台拒绝本地回调，应使用实际可访问的 HTTPS 开发域名并同步修改 PUBLIC_ORIGIN、网站访问地址和平台回调；不能只改其中一处。服务在发起授权前检查浏览器 Origin，避免在 localhost 发起、127.0.0.1 回调导致 Cookie 丢失。代理需保留浏览器的 Origin 请求头。

在需要接入的平台创建 OAuth 应用，然后在根目录 `.env.docker` 中配置：

```dotenv
ATOMFORGE_PUBLIC_ORIGIN=http://127.0.0.1:8080
ATOMFORGE_GITHUB_CLIENT_ID=
ATOMFORGE_GITHUB_CLIENT_SECRET=
ATOMFORGE_GITEE_CLIENT_ID=
ATOMFORGE_GITEE_CLIENT_SECRET=
ATOMFORGE_NETLIFY_CLIENT_ID=
ATOMFORGE_NETLIFY_CLIENT_SECRET=
```

生产环境将 PUBLIC_ORIGIN 换成 AtomForge 工作台实际使用的 HTTPS 根地址，不带路径。浏览器、OAuth 应用回调、PUBLIC_ORIGIN 的主机名和端口必须一致；localhost 与 127.0.0.1 不可混用。

平台回调地址分别为：

- `{PUBLIC_ORIGIN}/api/v1/af-auth/oauth/github/callback`
- `{PUBLIC_ORIGIN}/api/v1/af-auth/oauth/gitee/callback`
- `{PUBLIC_ORIGIN}/api/v1/af-auth/oauth/netlify/callback`

OAuth 应用注册入口：[GitHub](https://github.com/settings/developers)、[Gitee](https://gitee.com/oauth/applications)、[Netlify](https://app.netlify.com/user/applications)。配置后重启后端。未配置的入口会明确显示尚未开通，不会跳转到无效授权页面。

只配置 Netlify 时，在仓库根目录运行 `.\configure-oauth.ps1 -Provider netlify`：保留当前网站地址，输入创建 OAuth 应用后获得的 Client ID、Client Secret（隐藏输入）。脚本不会修改已有 GitHub / Gitee 凭据；`.\configure-oauth.ps1 -Check -Provider netlify` 只显示配置状态与回调地址，不输出密钥。重启后端后，从配置中的网站地址登录，在“发布与部署”点击“重新检查连接”，然后连接 Netlify 完成授权。生产环境建议创建独立的 `AtomForge Production` 应用，使用生产 HTTPS 回调并将凭据配置到服务器环境文件。

已有 AtomForge 用户应从个人中心或“发布与部署”连接第三方账号，绑定后可以通过该身份登录并访问原项目。首次直接第三方登录会创建独立账号，不会按未验证邮箱自动合并现有账号。首次创建的账号使用平台 ID 生成唯一用户名和占位邮箱，可以在个人中心修改资料。

GitHub 登录使用 read:user / user:email 权限以及 PKCE；发布授权才额外请求 repo。Gitee 使用 user_info，发布时增加 projects。Netlify 仅作为已登录账号的部署连接，不作为登录入口。state 和登录交换票据与 HttpOnly 浏览器 Cookie 绑定、短时有效、单次使用。第三方令牌只在服务端加密保存，不返回浏览器。务必保持 ATOMFORGE_JWT_SECRET 稳定，轮换它会使旧会话及加密连接失效。

## 发布源码

项目右上角“发布与部署” → 连接 GitHub / Gitee → 选择新建仓库或填写已有仓库的 owner/repo → 发布。

- 新仓库默认私有，可显式选择公开；已有仓库的可见性不变。
- 输出包含完整源码、package.json、Vite 配置、环境变量示例及运行说明。
- 每次交付写入 `atomforge-v版本-交付ID` 独立分支，应用位于分支根目录；默认分支不被覆盖。
- GitHub 用单次 tree / commit / ref 创建发布分支；Gitee 在独立分支逐文件上传，只有全部成功才显示完成。失败可能留下未完成分支，交付记录会保留仓库信息。
- 重试源码发布使用原来的版本快照和一个新分支，不改变工作区或其他分支。创建仓库时若网络中断导致结果不明确，请先检查平台同名仓库，使用“已有仓库”再次发布。

## Netlify 公网部署

1. 连接 Netlify OAuth 账号。开发或自托管时也可在“使用个人令牌连接”填写自己的 Netlify PAT；GitHub / Gitee 发布同样支持项目级个人令牌。
2. 生成任务完成验收，或在“应用云服务、构建与站内快照”执行构建检查。
3. 点击“部署并生成公网链接”。AtomForge 读取已检查版本、创建独立 Netlify 站点、上传缺失文件，检查待发布地址，再切换线上部署并检查正式地址。
4. 成功后展示真实的 `https://站点名.netlify.app` 地址。后续部署复用项目站点和正式地址。部署使用所连接 Netlify 账号的配额和套餐。

若公网检查提示 HTTP 401，站点可能继承了 Netlify 团队的 Private 默认可见性，或启用了密码保护。在该站点的 Project configuration → General → Visitor access 中检查 Project visibility。当前流程会在切换正式版本前匿名检查预览地址，因此公开部署需要预览与正式地址均可公开访问；明确选择公开后，再点击原交付记录的“继续部署检查”，复用已上传的文件。不要为解决单个站点的问题修改整个团队的访问默认值。HTTP 403 应检查访问规则；超时或版本未同步可以稍后继续检查。参考 [Netlify 项目可见性](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/)。

交付记录持续保存进度；刷新或关闭面板不停止后端部署。进程重启时标记中断，用户可继续检查已有部署，而无需重复上传。待发布版本检查失败不会替换正式版本；切换后的检查失败时，有上一版则尝试恢复，并显示恢复结果。没有上一版或恢复失败时会明确报告，不能当成已上线。

部署包是独立运行的 HTML、JS、CSS 和应用服务桥接代码，不依赖工作台 iframe，也不导出工作台令牌、模型密钥或业务数据。SPA 刷新由 Netlify 重写到 index.html。

**启用云服务的应用**还依赖 AtomForge 后端。后端必须已运行在 PUBLIC_ORIGIN 指定的 HTTPS 公网地址；部署包会为应用 API 添加反向代理。后端只在 localhost 运行时会阻止这类应用部署并说明原因。纯前端 / localStorage 应用可以直接部署。支付等额外服务仍需配置其公网回调与返回地址。

“站内应用快照”保留原来的功能，不代表已部署到公网。本机工作台生成的 127.0.0.1 地址不能供他人远程访问。

## 数据升级与验证

SQLite 由 Docker 启动入口的 `scripts/bootstrap_db.py` 执行增量建表，升级前自动备份，保留用户数据。外部数据库执行新的 Alembic 增量迁移。新增表为 af_external_identities、af_oauth_flows、af_deliveries。

自动测试覆盖账号绑定与隔离、Cookie / state 防重放、权限和构建门禁、令牌不回显、独立分支上传、Netlify 续传与上线前检查。真正的 OAuth 同意、远端仓库写入及公网部署需要实例运营者配置有效平台凭据，不能用模拟测试结果代替真实上线。

登录页浏览器回归：启动本地前端后，在 `app/frontend` 运行 `pnpm test:auth`（默认 `http://127.0.0.1:8080`，可用 `AUTH_TEST_ORIGIN` 修改）。测试独立浏览器会话、拦截全部 API 和平台授权响应，覆盖邮箱注册、密码错误、未开通提示、GitHub/Gitee 跳转和票据交换、取消授权，截图输出到 `node_modules/.auth-check`；不使用真实账号或密钥。

参考：[GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)、[Gitee OAuth](https://gitee.com/api/v5/oauth_doc)、[Netlify 部署 API](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/)、[Netlify API 定义](https://github.com/netlify/open-api)。

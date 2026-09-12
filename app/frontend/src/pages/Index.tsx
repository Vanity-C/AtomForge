/**
 * Landing page. Visitors can browse it without logging in; the primary CTA
 * routes into the dashboard once the AtomForge session is resolved.
 */
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Code2,
  GitBranch,
  MonitorPlay,
  Package,
  Share2,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TopBar, useAuth, useGoToAuth } from '@/components/AppShell';

const CAPABILITIES = [
  {
    icon: Bot,
    title: '对话式生成',
    body: '描述你想要的应用，工程师或智能体团队完成规划、代码修改和验证。',
  },
  {
    icon: MonitorPlay,
    title: '实时运行预览',
    body: '生成代码经过隔离构建与浏览器检查，通过后可在右侧预览中真实操作。',
  },
  {
    icon: Code2,
    title: '在线改代码',
    body: '文件树 + 编辑器随时接管智能体的产出，手动修改保存后立刻重新运行。',
  },
  {
    icon: GitBranch,
    title: '版本与回滚',
    body: '每次生成或手改都会留下完整快照，任何一个历史版本都能一键回到当前。',
  },
  {
    icon: Share2,
    title: '公开只读分享',
    body: '生成分享链接，访客免登录就能看到应用真实运行效果与只读源码。',
  },
  {
    icon: Package,
    title: '源码导出',
    body: '把项目打包成 zip 下载到本地，继续在自己的工程里扩展。',
  },
];

const FLOW = [
  { step: '01', title: '注册账号', body: '设置用户名、邮箱和密码，创建自己的账号' },
  { step: '02', title: '描述需求', body: '用一句中文说明你要的应用' },
  { step: '03', title: '智能体生成', body: '生成并验证 React 应用代码' },
  { step: '04', title: '预览 / 改 / 分享', body: '运行、编辑、回滚、导出、分享' },
];

const SAMPLE_PROMPTS = [
  '做一个番茄钟，支持自定义时长和任务清单',
  '做一个个人记账应用，能按分类统计月度支出',
  '做一个看板式待办应用，支持拖拽和标签筛选',
];

export default function Index() {
  const navigate = useNavigate();
  const { authState, user } = useAuth();
  const goToAuth = useGoToAuth();

  const handlePrimary = (prompt?: string) => {
    if (authState === 'loading') return;
    if (authState !== 'authenticated') {
      // Remember the requested prompt so it survives the sign-up detour.
      const target = prompt ? `/dashboard?prompt=${encodeURIComponent(prompt)}` : '/dashboard';
      navigate(`/auth?mode=register&redirect=${encodeURIComponent(target)}`);
      return;
    }
    navigate(prompt ? `/dashboard?prompt=${encodeURIComponent(prompt)}` : '/dashboard');
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar
        authState={authState}
        user={user}
        right={
          authState === 'authenticated' ? (
            <Button size="sm" className="h-8 px-3 text-xs" onClick={() => navigate('/dashboard')}>
              进入工作台
            </Button>
          ) : null
        }
      />

      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-border">
          <div className="pointer-events-none absolute inset-0 grid-fade" aria-hidden />
          <div className="relative mx-auto grid max-w-screen-xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-5 lg:px-8 lg:py-28">
            <div className="lg:col-span-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                智能体驱动的应用生成平台
              </span>
              <h1 className="mt-6 max-w-2xl text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
                把一句话
                <br />
                变成能跑起来的应用
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
                AtomForge 让智能体替你写代码：你只描述需求，它输出完整的多文件 React
                工程，并在浏览器里立即运行。代码、版本、对话全部持久化，随时回来继续改。
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button
                  size="lg"
                  className="h-11 gap-2 px-5"
                  disabled={authState === 'loading'}
                  onClick={() => handlePrimary()}
                >
                  {authState === 'authenticated' ? '进入我的工作台' : '免费注册开始构建'}
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">无需配置环境，浏览器内直接运行</span>
              </div>

              <div className="mt-10">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  试试这些需求
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SAMPLE_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => handlePrimary(prompt)}
                      className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-secondary-foreground transition-colors duration-200 ease-out-quart hover:md:border-primary/45 hover:md:bg-accent"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <span className="h-2 w-2 rounded-full bg-destructive/50" />
                  <span className="h-2 w-2 rounded-full bg-[hsl(38_80%_60%)]" />
                  <span className="h-2 w-2 rounded-full bg-success/60" />
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                    agent · deepseek-flash
                  </span>
                </div>
                <div className="space-y-3 p-4">
                  <div className="ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                    做一个番茄钟，支持任务清单
                  </div>
                  <div className="max-w-[92%] rounded-lg rounded-bl-sm bg-secondary px-3 py-2 text-sm text-secondary-foreground">
                    好的，我会拆成计时器、任务列表和统计三个模块，共 4 个文件。
                  </div>
                  <div className="code-surface rounded-md border border-border/70 p-3">
                    <p className="text-[11px] text-muted-foreground">App.jsx</p>
                    <pre className="mt-1.5 whitespace-pre-wrap leading-relaxed">{`export default function App() {
  const [left, setLeft] = useState(1500);
  const [running, setRunning] = useState(false);
  return <Timer left={left} />;
}`}</pre>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    应用已运行 · v1 已保存
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-screen-xl px-4 py-16 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-semibold tracking-tight">从想法到可体验产品的完整链路</h2>
          <div className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {FLOW.map((item) => (
              <div key={item.step} className="border-t-2 border-primary/25 pt-4">
                <p className="tnum font-mono text-xs font-semibold text-primary">{item.step}</p>
                <p className="mt-2 text-base font-semibold">{item.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-border bg-card/60">
          <div className="mx-auto max-w-screen-xl px-4 py-16 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-semibold tracking-tight">平台能力</h2>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              不只是生成代码，而是一个能持续迭代、可分享、可导出的应用工作台。
            </p>
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map(({ icon: Icon, title, body }) => (
                <div
                  key={title}
                  className="rounded-lg border border-border bg-card p-5 transition-shadow duration-200 ease-out-quart hover:md:shadow-sm"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="mt-3.5 text-base font-semibold">{title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-screen-xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="rounded-lg border border-border bg-primary px-8 py-12 text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-primary-foreground">
              现在就让智能体写第一个应用
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-primary-foreground/80">
              登录后创建项目，几分钟内就能拿到一个能运行、能分享、能导出的成品。
            </p>
            <Button
              size="lg"
              variant="secondary"
              className="mt-7 h-11 gap-2 px-5"
              disabled={authState === 'loading'}
              onClick={() => handlePrimary()}
            >
              {authState === 'authenticated' ? '进入我的工作台' : '注册 / 登录'}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-6">
        <div className="mx-auto flex max-w-screen-xl flex-col items-center justify-between gap-2 px-4 text-xs text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
          <span>AtomForge · 智能体驱动的应用生成 Demo</span>
          <div className="flex items-center gap-4">
            <a className="hover:text-foreground" href="/demo-guide.html">Demo 说明</a>
            <a className="hover:text-foreground" href="https://github.com/Vanity-C/AtomForge" target="_blank" rel="noreferrer">GitHub 源码</a>
            <span>v0.1.0 · DeepSeek</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

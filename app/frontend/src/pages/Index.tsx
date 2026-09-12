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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import ForgeSculpture from '@/components/ForgeSculpture';
import { TopBar, useAuth } from '@/components/AppShell';

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

export default function Index() {
  const navigate = useNavigate();
  const { authState, user } = useAuth();

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
      <TopBar authState={authState} user={user}/>
      <main className="studio-page landing-page">
        <div className="studio-eyebrow"><span>独立想法的创作工作室</span><span className="font-mono">ATOMFORGE / VOL. 02</span></div>
        <section className="landing-hero">
          <div><p className="studio-kicker">GOOD IDEAS DESERVE TO EXIST.</p><h1>有个想法？<br/>让它<span className="landing-serif">成真。</span></h1><p className="landing-copy">为自己的生活做一个工具，为喜欢的事情建一个小站。<br className="hidden sm:block"/>你带来想法，和你的智能体搭档一起把它做出来。</p>
            <Button disabled={authState==='loading'} className="landing-cta" onClick={()=>handlePrimary()}>{authState==='authenticated'?'进入我的工作室':'开始第一个作品'}<ArrowRight className="h-4 w-4"/></Button>
            <p className="mt-4 text-xs text-muted-foreground">在浏览器里创作、体验，继续打磨。</p>
          </div>
          <div className="landing-object"><ForgeSculpture/><div><span>从一个想法，到一种可能。</span><span className="font-mono">FIG. 001</span></div></div>
        </section>
        <section className="landing-process" aria-label="创作流程">
          {[
            ['01','先聊聊，想做什么。','说清楚一个小需求。工程师直接动手，或让整个团队和你一起推敲。'],
            ['02','让想法有了形状。','看着应用一点点完成。直接体验功能，哪里不对，就继续聊、继续改。'],
            ['03','这是你的作品。','代码、对话和每一个版本都会留下。分享给朋友，或导出源码继续创作。'],
          ].map(([number,title,body])=><div key={number}><span className="studio-kicker">{number} /</span><h2>{title}</h2><p>{body}</p></div>)}
        </section>
        <section className="landing-capabilities"><div><p className="studio-kicker">MADE TO BE YOURS</p><h2>创作自由，<br/>也掌握细节。</h2><p className="mt-5 text-sm leading-7 text-muted-foreground">从第一稿，到满意为止。<br/>工作台里的工具，随时听你调度。</p></div><div className="landing-tools">{CAPABILITIES.map(({icon:Icon,title,body})=><div key={title}><Icon className="h-4 w-4"/><div><h3>{title}</h3><p>{body}</p></div></div>)}</div></section>
        <section className="landing-invitation"><div><p className="studio-kicker">YOUR NEXT CHAPTER</p><h2>下一件作品，<br/>从你开始。</h2></div><Button disabled={authState==='loading'} onClick={()=>handlePrimary()} className="landing-cta">打开创作工作室<ArrowRight className="h-4 w-4"/></Button></section>
        <footer className="studio-footer"><span>AtomForge.</span><span>想法在这里，长出自己的样子。</span><div className="flex gap-5"><a href="/demo-guide.html">使用说明</a><a href="https://github.com/Vanity-C/AtomForge" target="_blank" rel="noreferrer">GitHub ↗</a></div></footer>
      </main>
    </div>
  );
}

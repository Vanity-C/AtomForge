import type {ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {ArrowLeft,ArrowUpRight,Check} from 'lucide-react';
import AgentAvatar from './AgentAvatar';
import '@/styles/auth.css';

export default function AuthShell({children}:{children:ReactNode}) {
  return <main className="auth-page">
    <section className="auth-entry" aria-label="账号登录与注册">
      <Link to="/" className="auth-back" aria-label="返回首页"><ArrowLeft size={19}/><span>返回首页</span></Link>
      <div className="auth-form-wrap">{children}</div>
      <p className="auth-entry-footer">一个想法，一支团队，无限可能。</p>
    </section>
    <aside className="auth-showcase" aria-label="认识 AtomForge">
      <Link className="auth-brand" to="/"><svg width="30" height="30" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M4 23 12 5h5l-8 18H4Zm9-11 5 11h6L16 5" fill="currentColor"/><path d="m10 18 10 2" stroke="currentColor" strokeWidth="3"/></svg>AtomForge<span>.</span></Link>
      <div className="auth-manifesto"><span className="auth-eyebrow">YOUR NEXT IDEA STARTS HERE</span><h2>好想法，<br/>值得被做出来。</h2><p>带上你的灵感，和专属团队一起<br/>把第一句话，变成可以使用的作品。</p>
        <ul>{['和团队聊需求，随时调整方向','从设计到开发，每一步都有伙伴','保留源码与版本，继续打磨你的作品'].map(text=><li key={text}><Check size={14}/>{text}</li>)}</ul>
      </div>
      <div className="auth-team-art" aria-hidden="true"><div className="auth-orbit"/><div className="auth-orbit auth-orbit-inner"/><div className="auth-companion auth-companion-neo"><AgentAvatar role="engineer" className="auth-art-avatar"/><span>Neo <small>让想法运行起来</small></span></div><div className="auth-companion auth-companion-atlas"><AgentAvatar role="leader" className="auth-art-avatar"/><span>Atlas <small>一起找到方向</small></span></div><div className="auth-companion auth-companion-pip"><AgentAvatar role="qa" className="auth-art-avatar"/><span>Pip <small>替你多想一步</small></span></div></div>
      <div className="auth-showcase-footer"><span>从想法，到交付。</span><ArrowUpRight size={21}/><span>BUILT TOGETHER</span></div>
    </aside>
  </main>;
}

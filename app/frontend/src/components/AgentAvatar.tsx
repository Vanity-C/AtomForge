import {useId} from 'react';
import {TEAM_ROLES} from '@/lib/studio';
import {useAgents} from './AgentProvider';
import type {AgentProfile} from '@/lib/agentProfiles';

const palettes:Record<string,{bg:string;coat:string;ink:string;shell:string}>={
  leader:{bg:'#f3efff',coat:'#a18aca',ink:'#655183',shell:'#d7c9ef'},
  product:{bg:'#fff2de',coat:'#eba044',ink:'#935524',shell:'#ffd08b'},
  design:{bg:'#fff0f6',coat:'#d87cb0',ink:'#88436e',shell:'#f5b8d8'},
  architect:{bg:'#eaf7f4',coat:'#5baca2',ink:'#30695f',shell:'#afe2d6'},
  engineer:{bg:'#edf4ff',coat:'#739de4',ink:'#385c98',shell:'#b5cffb'},
  qa:{bg:'#f0f8e7',coat:'#94ba62',ink:'#507536',shell:'#d2e7ab'},
};

/** Original egg companions: one shell silhouette, five profession-specific toolkits. */
export default function AgentAvatar({role:requestedRole,className='h-9 w-9',person}:{role:string;className?:string;person?:AgentProfile}){
  const id=useId().replace(/:/g,'');
  const {team}=useAgents();
  const profile=person||team[requestedRole];
  const style=profile?.avatar_style||requestedRole;
  const role=palettes[style]?style:'engineer';
  const p=palettes[role];
  const name=profile?.name||TEAM_ROLES.find(r=>r.id===role)!.alias;
  if(profile?.avatar)return <img src={profile.avatar} alt={`${name}的头像`} className={`shrink-0 rounded-full object-cover ${className}`}/>;
  return <svg viewBox="0 0 96 96" role="img" aria-label={`${name}的蛋形头像`} className={`agent-avatar shrink-0 overflow-visible ${className}`}>
    <defs>
      <radialGradient id={id} cx="30%" cy="20%" r="85%"><stop stopColor="#fff"/><stop offset="1" stopColor={p.bg}/></radialGradient>
      <radialGradient id={`${id}-shell`} cx="32%" cy="24%" r="80%"><stop stopColor="#fffdf4"/><stop offset=".5" stopColor={p.bg}/><stop offset="1" stopColor={p.shell}/></radialGradient>
    </defs>
    <circle cx="48" cy="48" r="46" fill={`url(#${id})`}/>
    <ellipse cx="48" cy="89" rx="29" ry="4" fill={p.ink} opacity=".12"/>
    <g className="agent-head">
      <ellipse cx="36" cy="87" rx="8" ry="3.5" fill={p.coat}/>
      <ellipse cx="59" cy="87" rx="8" ry="3.5" fill={p.coat}/>
      <path d="M48 11C34 11 19 38 19 59c0 20 12 28 29 28s29-8 29-28C77 38 62 11 48 11Z" fill={`url(#${id}-shell)`} stroke={p.coat} strokeWidth="1.2"/>
      <path d="M33 29q-7 9-8 19" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity=".75"/>
      <ellipse cx="38" cy="46" rx="2.8" ry="3.6" fill="#34404b"/><ellipse cx="57" cy="46" rx="2.8" ry="3.6" fill="#34404b"/>
      <circle cx="39" cy="45" r="1" fill="#fff"/><circle cx="58" cy="45" r="1" fill="#fff"/>
      <ellipse cx="30" cy="54" rx="5" ry="2.7" fill="#f1a1a1" opacity=".5"/><ellipse cx="65" cy="54" rx="5" ry="2.7" fill="#f1a1a1" opacity=".5"/>
      <path d="M43 55q5 6 10 0" stroke={p.ink} fill="none" strokeWidth="2" strokeLinecap="round"/>
      {role==='leader'&&<><path d="M30 27q18-23 36 0" fill={p.ink}/><path d="M29 28h38" stroke={p.coat} strokeWidth="4" strokeLinecap="round"/><path d="m45 64 4 4 4-4-4 14Z" fill={p.ink}/><circle cx="62" cy="64" r="4" fill="#dec075"/></>}
      {role==='product'&&<><path d="m35 65 11 3-11 5Zm25 0-11 3 11 5Z" fill={p.ink}/><circle cx="47.5" cy="68" r="2.5" fill={p.coat}/><path d="M37 20h23l-3 6H39Z" fill={p.coat}/><rect x="40" y="12" width="17" height="10" rx="4" fill={p.coat}/><path d="M41 20h15" stroke={p.ink} strokeWidth="2"/></>}
      {role==='design'&&<><path d="M27 24C23 15 37 8 51 10s20 8 17 15l-18 4Z" fill={p.ink}/><path d="M31 27q18 5 33-1" fill="none" stroke={p.coat} strokeWidth="4" strokeLinecap="round"/><path d="m48 11 3-5" stroke={p.ink} strokeWidth="3" strokeLinecap="round"/><circle cx="28" cy="64" r="3" fill="#eaa94d"/><circle cx="35" cy="68" r="2" fill={p.coat}/></>}
      {role==='architect'&&<><path d="M28 28h40M32 27c0-12 7-16 16-16s16 4 16 16" fill="#d2ebe5" stroke={p.ink} strokeWidth="2.5" strokeLinecap="round"/><path d="M48 13v12" stroke={p.coat} strokeWidth="3"/><g fill="none" stroke={p.ink} strokeWidth="2"><rect x="28" y="39" width="17" height="14" rx="5"/><rect x="50" y="39" width="17" height="14" rx="5"/><path d="M45 44h5"/></g></>}
      {role==='engineer'&&<><path d="M21 46v-7c0-18 11-27 27-27s27 9 27 27v7" fill="none" stroke={p.ink} strokeWidth="4"/><rect x="17" y="40" width="8" height="16" rx="4" fill={p.coat}/><rect x="71" y="40" width="8" height="16" rx="4" fill={p.coat}/><path d="M75 54q-2 9-14 9" fill="none" stroke={p.ink} strokeWidth="2"/><rect x="56" y="60" width="8" height="4" rx="2" fill={p.ink}/></>}
      {role==='qa'&&<><path d="M32 27q16-21 32 0" fill={p.coat}/><path d="M30 28h36" stroke={p.ink} strokeWidth="3" strokeLinecap="round"/><path d="m45 20 3 3 5-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></>}
      <ellipse cx="20" cy="68" rx="5" ry="9" fill={p.shell} stroke={p.coat} strokeWidth="1" transform="rotate(-25 20 68)"/>
    </g>
    <g className="agent-wave"><path d="M73 75q5-6 6-13" fill="none" stroke={p.coat} strokeWidth="7" strokeLinecap="round"/><path d="M77 66c-5-7-3-17 1-19 6-4 12 8 10 15-1 6-7 9-11 4Z" fill={`url(#${id}-shell)`} stroke={p.coat} strokeWidth="1.2"/><path d="M80 51q4 3 4 8" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".8"/></g>
    {role==='product'&&<g transform="rotate(-9 38 77)"><rect x="25" y="65" width="28" height="27" rx="3" fill={p.ink}/><rect x="28" y="68" width="22" height="21" rx="1" fill="#fffaf2"/><rect x="33" y="63" width="12" height="5" rx="2" fill="#efb867"/><path d="m31 75 2 2 3-4m2 2h9m-16 8 2 2 3-4m2 2h9" fill="none" stroke={p.ink} strokeWidth="1.7" strokeLinecap="round"/></g>}
    {role==='design'&&<><g transform="rotate(-8 39 79)"><rect x="23" y="69" width="34" height="23" rx="3" fill={p.ink}/><rect x="26" y="72" width="28" height="16" rx="1" fill="#fff5fa"/><path d="m30 83 6-7 6 7 7-5" fill="none" stroke={p.coat} strokeWidth="2"/><circle cx="47" cy="76" r="2" fill="#ecad48"/></g><path d="m60 84 6-25" stroke={p.ink} strokeWidth="3" strokeLinecap="round"/><path d="m64 61 3-7 2 8Z" fill="#edac48"/></>}
    {role==='architect'&&<g transform="rotate(-6 41 79)"><rect x="23" y="68" width="39" height="24" rx="2" fill="#e4f4f6" stroke={p.ink} strokeWidth="1.5"/><path d="M41 73v6m-11 0h23m-23 0v7m23-7v7" stroke={p.coat} strokeWidth="1.5"/><rect x="36" y="71" width="10" height="6" rx="1" fill={p.ink}/><rect x="26" y="83" width="9" height="6" rx="1" fill={p.coat}/><rect x="48" y="83" width="9" height="6" rx="1" fill={p.coat}/></g>}
    {role==='engineer'&&<><rect x="23" y="69" width="42" height="23" rx="3" fill="#253858"/><path d="m37 76-5 4 5 4m16-8 5 4-5 4m-6-10-4 12" fill="none" stroke="#8fd8ff" strokeWidth="2" strokeLinecap="round"/><path d="M19 91h50" stroke={p.ink} strokeWidth="3" strokeLinecap="round"/></>}
    {role==='qa'&&<><rect x="23" y="68" width="27" height="24" rx="2" fill="#f6ffed" stroke={p.ink} strokeWidth="1.5"/><path d="m27 75 2 2 4-4m3 2h9m-18 8 2 2 4-4m3 2h9" fill="none" stroke={p.coat} strokeWidth="1.8" strokeLinecap="round"/><path d="m62 79 6 10" stroke={p.ink} strokeWidth="5" strokeLinecap="round"/><circle cx="58" cy="73" r="10" fill="#ecffff" fillOpacity=".9" stroke={p.ink} strokeWidth="3"/><path d="m53 73 3 3 6-7" fill="none" stroke={p.coat} strokeWidth="2" strokeLinecap="round"/></>}
    <g className="agent-spark" fill={p.coat}><path d="m12 36 2-5 2 5 5 2-5 2-2 5-2-5-5-2Z"/><circle cx="82" cy="21" r="2.5"/></g>
  </svg>;
}

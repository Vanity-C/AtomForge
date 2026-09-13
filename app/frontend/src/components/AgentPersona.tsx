import {useAgentTeam} from './AgentProvider';
import {displayAgent,type AgentProfile} from '@/lib/agentProfiles';
import AgentAvatar from './AgentAvatar';
import AgentIntroduction from './AgentIntroduction';

/** The same introduction is available on hover, keyboard focus and touch. */
export default function AgentPersona({role,avatarClassName='h-9 w-9',className='',onClick,selected,disabled,label,profile}:{role:string;avatarClassName?:string;className?:string;onClick?:()=>void;selected?:boolean;disabled?:boolean;label?:string;profile?:AgentProfile}){
  const team=useAgentTeam();
  const member=profile||team[role]||Object.values(team).find(agent=>agent.id===role)||Object.values(team)[0];
  const person=displayAgent(member);
  return <AgentIntroduction person={person.profile} openOnClick>
    <button type="button" aria-label={label||`${person.alias} ${person.name}：查看角色介绍`} aria-pressed={selected} disabled={disabled} onClick={()=>onClick?.()} className={`agent-persona relative shrink-0 rounded-full outline-none transition-transform hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 disabled:opacity-50 ${className}`}>
      <AgentAvatar role={role} person={person.profile} className={avatarClassName} showIntroduction={false}/>
    </button>
  </AgentIntroduction>;
}

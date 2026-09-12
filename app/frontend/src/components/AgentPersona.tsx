import {useState} from 'react';
import {Portal} from '@radix-ui/react-tooltip';
import {Tooltip,TooltipTrigger,TooltipContent} from '@/components/ui/tooltip';
import {TEAM_ROLES} from '@/lib/studio';
import AgentAvatar from './AgentAvatar';

/** The same introduction is available on hover, keyboard focus and touch. */
export default function AgentPersona({role,avatarClassName='h-9 w-9',className='',onClick,selected,disabled,label}:{role:string;avatarClassName?:string;className?:string;onClick?:()=>void;selected?:boolean;disabled?:boolean;label?:string}){
  const [open,setOpen]=useState(false);
  const person=TEAM_ROLES.find(r=>r.id===role)||TEAM_ROLES[3];
  return <Tooltip open={open} onOpenChange={setOpen} delayDuration={100}>
    <TooltipTrigger asChild><button type="button" aria-label={label||`${person.alias} ${person.name}：查看角色介绍`} aria-pressed={selected} disabled={disabled} data-greeting={open?'true':'false'} onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)} onClick={event=>{event.preventDefault();onClick?.();setOpen(true);}} className={`agent-persona relative shrink-0 rounded-full outline-none transition-transform hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 disabled:opacity-50 ${open?'z-20':''} ${className}`}>
      <AgentAvatar role={role} className={avatarClassName}/>
    </button></TooltipTrigger>
    <Portal><TooltipContent side="top" sideOffset={12} collisionPadding={16} className="max-w-[min(280px,calc(100vw-32px))] rounded-xl border-border/60 px-4 py-3 shadow-xl">
      <p className="text-sm font-semibold">{person.alias} <span className="font-normal text-muted-foreground">{person.nickname}</span><span className="ml-2 text-primary">{person.name}</span></p>
      <p className="mt-2 text-xs leading-5">{person.greeting}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{person.task}。</p>
      <p className="mt-2 border-t pt-2 text-[10px] text-muted-foreground">{person.equipment}</p>
    </TooltipContent></Portal>
  </Tooltip>;
}

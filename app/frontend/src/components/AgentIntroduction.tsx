import {cloneElement,useLayoutEffect,useRef,useState,type HTMLAttributes,type ReactElement,type Ref} from 'react';
import {Portal} from '@radix-ui/react-tooltip';
import {Tooltip,TooltipContent,TooltipTrigger} from '@/components/ui/tooltip';
import type {AgentProfile} from '@/lib/agentProfiles';
import '@/styles/agent-introduction.css';

type TriggerProps=HTMLAttributes<HTMLElement>&{ref?:Ref<Element>};

/** One shared greeting for portrait buttons, clickable cards and plain avatars. */
export default function AgentIntroduction({person,children,followParent=false,openOnClick=false,side='top'}:{person:AgentProfile;children:ReactElement<TriggerProps>;followParent?:boolean;openOnClick?:boolean;side?:'top'|'right'|'bottom'|'left'}){
  const [open,setOpen]=useState(false);
  const [standalone,setStandalone]=useState(false);
  const trigger=useRef<Element>(null);
  useLayoutEffect(()=>{
    if(!followParent||!trigger.current)return;
    const node=trigger.current;
    const hidden=node.closest('[aria-hidden="true"],[inert]');
    const action=node.parentElement?.closest<HTMLElement>('button,a[href],[role="button"],[role="tab"]');
    // A profile editor's large decorative preview must not become the dialog's
    // autofocus target; its actual controls already expose the same identity.
    setStandalone(!action&&!hidden&&!node.closest('[role="dialog"]'));
    if(!action||hidden)return;
    const portraits=action.querySelectorAll('[data-agent-avatar]');
    const single=portraits.length===1;
    // A multi-person stack keeps one keyboard introduction for its card; pointer
    // hover still identifies each portrait independently without nested buttons.
    const first=portraits[0]===node;
    const enter=()=>{if(single)setOpen(true);};
    const leave=()=>{if(!action.matches(':focus-visible'))setOpen(false);};
    const focus=()=>{if(first&&action.matches(':focus-visible'))setOpen(true);};
    const blur=()=>setOpen(false);
    const click=()=>setOpen(false);
    action.addEventListener('mouseenter',enter);
    action.addEventListener('mouseleave',leave);
    action.addEventListener('focus',focus);
    action.addEventListener('blur',blur);
    action.addEventListener('click',click);
    return()=>{
      action.removeEventListener('mouseenter',enter);
      action.removeEventListener('mouseleave',leave);
      action.removeEventListener('focus',focus);
      action.removeEventListener('blur',blur);
      action.removeEventListener('click',click);
    };
  },[followParent,person]);
  useLayoutEffect(()=>{
    if(!open||!followParent||!trigger.current)return;
    const action=trigger.current.parentElement?.closest<HTMLElement>('button,a[href],[role="button"],[role="tab"]');
    const description=trigger.current.getAttribute('aria-describedby');
    if(!action||!description)return;
    const ids=new Set((action.getAttribute('aria-describedby')||'').split(' ').filter(Boolean));
    if(ids.has(description))return;
    action.setAttribute('aria-describedby',[...ids,description].join(' '));
    return()=>{
      const current=(action.getAttribute('aria-describedby')||'').split(' ').filter(id=>id&&id!==description);
      if(current.length)action.setAttribute('aria-describedby',current.join(' '));
      else action.removeAttribute('aria-describedby');
    };
  },[open,followParent]);
  const child=cloneElement(children,{
    ref:trigger,
    tabIndex:standalone?0:children.props.tabIndex,
    role:standalone?'button':children.props.role,
    'aria-label':standalone?`${person.name} · ${person.title}：查看介绍`:children.props['aria-label'],
    ...{'data-agent-introduction':'true','data-greeting':open?'true':'false'},
    onFocus:event=>{children.props.onFocus?.(event);setOpen(true);},
    onBlur:event=>{children.props.onBlur?.(event);setOpen(false);},
    onClick:event=>{
      children.props.onClick?.(event);
      if(openOnClick||standalone){event.preventDefault();setOpen(true);}
      else setOpen(false);
    },
    onKeyDown:event=>{
      children.props.onKeyDown?.(event);
      if(standalone&&(event.key==='Enter'||event.key===' ')){event.preventDefault();setOpen(true);}
    },
  });
  return <Tooltip open={open} onOpenChange={setOpen} delayDuration={120}>
    <TooltipTrigger asChild>{child}</TooltipTrigger>
    <Portal><TooltipContent side={side} sideOffset={12} collisionPadding={16} className="agent-introduction">
      <div className="agent-introduction-heading"><strong>{person.name}</strong><span>{person.title}</span></div>
      <p className="agent-introduction-greeting">{person.greeting}</p>
      <div className="agent-introduction-detail"><span>擅长的事</span><p>{person.responsibilities}</p></div>
      <div className="agent-introduction-detail agent-introduction-personality"><span>相处方式</span><p>{person.personality}</p></div>
    </TooltipContent></Portal>
  </Tooltip>;
}

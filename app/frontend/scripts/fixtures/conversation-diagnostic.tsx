// Isolated regression for historical QA messages; no account or backend calls.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import AgentReply from '../../src/components/AgentReply';
import {TooltipProvider} from '../../src/components/ui/tooltip';
import {groupConversation,type ConversationMessage} from '../../src/lib/conversation';
import '../../src/index.css';

const diagnostic={error:'测试计划需要补充',tests_count:0,scenarios:[{name:'保存',steps:0}],total_scenario_steps:0,contract:{min_total_steps:2,max_total_steps:1000}};
const message=(id:number,content:string,value:unknown,kind='activity'):ConversationMessage=>({id,run_id:'diagnostic-fixture',sender:'qa',recipient:'all',kind,content,detail:{diagnostic:value},created:'2026-09-16T00:00:00Z'});
const cases:Record<string,ConversationMessage[]>={
  collapsed:[message(1,'历史测试诊断',diagnostic),message(2,'草稿和测试报告已保留',undefined,'summary')],
  structured:[message(3,'结构化诊断',diagnostic)],
  legacy:[message(4,'旧版文字诊断','保留原始错误\n第二行')],
  missing:[message(5,'暂无诊断信息',null)],
  array:[message(6,'多项诊断',['步骤不足',{expected:2,actual:0}])],
};
function Fixture(){
  const [selected,setSelected]=useState('collapsed');
  const [expanded,setExpanded]=useState(false);
  return <main className="mx-auto max-w-3xl space-y-4 p-4"><h1>对话诊断回归</h1><label>诊断场景<select aria-label="诊断场景" value={selected} onChange={event=>{setSelected(event.target.value);setExpanded(false);}}>{Object.keys(cases).map(name=><option key={name}>{name}</option>)}</select></label>
    {groupConversation(cases[selected]).map(reply=><AgentReply key={selected+reply.id} reply={reply} active={false} waiting={false} expanded={expanded} onToggle={()=>setExpanded(value=>!value)} canEdit={false} onImplement={()=>{}} filePaths={[]} onOpenFile={()=>{}}/>)}
  </main>;
}
createRoot(document.getElementById('root')!).render(<TooltipProvider><Fixture/></TooltipProvider>);

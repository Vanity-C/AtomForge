// Isolated report fixture: no account, model, workspace or external API.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import QaReport from '../../src/components/QaReport';
import DeliveryBoard from '../../src/components/DeliveryBoard';
import {TooltipProvider} from '../../src/components/ui/tooltip';
import type {TeamOutput,StudioRun} from '../../src/lib/studio';
import '../../src/index.css';

const scenarios=['新增任务','刷新恢复','删除任务'].map(name=>({name,tests:[
  {action:'visible',selector:'h1'}, {action:'text',selector:'h1',value:name},
]}));
function Fixture(){
  const [state,setState]=useState('collecting');
  const [wholeBoard,setWholeBoard]=useState(false);
  const finished=state==='passed';
  const output:TeamOutput={summary:finished?'当前源码审查通过':'删除行为尚未符合需求',verified:finished,
    scenarios:state==='legacy'?undefined:scenarios,tests:state==='legacy'?scenarios[0].tests:undefined,
    limitations:['外部支付条件未验证'],
    verification:{sourceRevision:'fixture',complete:state==='failed'||finished,
      issues:finished?[]:['删除后计数没有更新','刷新后任务丢失'],selfTest:{ok:true},
      issueDetails:state==='legacy'||finished?undefined:[
        {description:'删除后计数没有更新',type:'ui',severity:'medium',location:'App.jsx / Counter'},
        {description:'刷新后任务丢失',type:'data',severity:'high',reproduction:'新增一条任务，再刷新页面',expected:'任务仍存在',actual:'任务列表为空',evidence:'没有写入持久化存储'},
      ],
      scenarios:scenarios.slice(0,state==='collecting'?1:3).map((item,i)=>({name:item.name,
        status:finished?'passed':i===0?'passed':i===1?'failed':'blocked',
        ...(i===1&&!finished?{error:'刷新后找不到新增任务',logs:['PASS visible h1','FAIL 持久化断言']}:{}),
        ...(i===2&&!finished?{reason:'挂载阻塞，场景未执行'}:{}),
      })),
    }};
  if(state==='triaged'){
    output.verification!.issues=['刷新后任务丢失'];
    output.verification!.issueDetails=[{description:'刷新后任务丢失',type:'data',severity:'high',disposition:'blocker',requirement:'刷新保留任务',impact:'用户保存的任务丢失'}];
    output.verification!.pendingIssues=[{description:'测试选择器仍需核实',type:'test',severity:'unknown',reason:'尚不能确认是测试脚本还是应用问题',evidence:'原始失败记录'}];
    output.verification!.advisories=[{description:'变量命名偏好',type:'other',severity:'low',reason:'不影响已确认行为',impact:'无功能影响'}];
    output.verification!.triageComplete=false;
  }
  const run:StudioRun={id:'qa-fixture',project_id:1,status:'running',stage:'repair',error:'',events:[],result:{team:{qa:output},workflow:{
    version:'fixture',revision:1,policy:{priority:'normal',wip:1,sla_minutes:60,max_repairs:2,min_tests:2},policy_history:[],
    columns:[{id:'doing',name:'进行中',entry:'收到工作包',exit:'完成检查',output:'实现',next:[]}],
    cards:[{id:'engineer',role:'engineer',owner:'default-engineer',owner_name:'应用工程师',title:'修复问题',tasks:['按反馈修复'],acceptance:[],collaborators:[],output:'实现',gate:'独立验收',depends_on:[],state:'doing',blocked:null,blocked_seconds:null,evidence:null,lane:'标准',cycle_seconds:0,overdue:false}],
    metrics:{completed_packages:0,rework_count:1,elapsed_seconds:10,escaped_defect_rate:null},
  }}};
  return <main className="mx-auto max-w-3xl p-4"><h1>QA 报告回归</h1><label>报告状态<select aria-label="报告状态" value={state} onChange={e=>setState(e.target.value)}>
    {['collecting','failed','passed','legacy','triaged'].map(value=><option key={value}>{value}</option>)}
  </select></label><label className="ml-3"><input type="checkbox" checked={wholeBoard} onChange={event=>setWholeBoard(event.target.checked)}/>测试完整看板</label>{wholeBoard?<DeliveryBoard run={run}/>:<QaReport output={output}/>}</main>;
}
createRoot(document.getElementById('root')!).render(<TooltipProvider><Fixture/></TooltipProvider>);

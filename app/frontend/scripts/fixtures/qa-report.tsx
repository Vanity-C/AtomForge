// Isolated report fixture: no account, model, workspace or external API.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import QaReport from '../../src/components/QaReport';
import type {TeamOutput} from '../../src/lib/studio';
import '../../src/index.css';

const scenarios=['新增任务','刷新恢复','删除任务'].map(name=>({name,tests:[
  {action:'visible',selector:'h1'}, {action:'text',selector:'h1',value:name},
]}));
function Fixture(){
  const [state,setState]=useState('collecting');
  const finished=state==='passed';
  const output:TeamOutput={summary:finished?'当前源码审查通过':'删除行为尚未符合需求',verified:finished,
    scenarios:state==='legacy'?undefined:scenarios,tests:state==='legacy'?scenarios[0].tests:undefined,
    limitations:['外部支付条件未验证'],
    verification:{sourceRevision:'fixture',complete:state==='failed'||finished,
      issues:finished?[]:['删除后计数没有更新','刷新后任务丢失'],selfTest:{ok:true},
      scenarios:scenarios.slice(0,state==='collecting'?1:3).map((item,i)=>({name:item.name,
        status:finished?'passed':i===0?'passed':i===1?'failed':'blocked',
        ...(i===1&&!finished?{error:'刷新后找不到新增任务',logs:['PASS visible h1','FAIL 持久化断言']}:{}),
        ...(i===2&&!finished?{reason:'挂载阻塞，场景未执行'}:{}),
      })),
    }};
  return <main className="mx-auto max-w-3xl p-4"><h1>QA 报告回归</h1><label>报告状态<select aria-label="报告状态" value={state} onChange={e=>setState(e.target.value)}>
    {['collecting','failed','passed','legacy'].map(value=><option key={value}>{value}</option>)}
  </select></label><QaReport output={output}/></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

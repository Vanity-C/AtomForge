// Isolated UI fixture with no real account, model or project data.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import DeliveryBoard from '../../src/components/DeliveryBoard';
import {TooltipProvider} from '../../src/components/ui/tooltip';
import {FALLBACK_TEAM} from '../../src/lib/agentProfiles';
import type {StudioRun} from '../../src/lib/studio';
import '../../src/index.css';

const roles=['product','design','architect','engineer','qa'];
const names=['明确范围与验收标准','设计核心操作路径','定义组件和数据契约','实现任务筛选','独立验证筛选与恢复'];
const initial:StudioRun={id:'fixture-run',project_id:1,mode:'team',agents:FALLBACK_TEAM,status:'running',stage:'test',events:[],error:'',result:{team:{leader:{goal:'让任务筛选和恢复清晰可用'}},workflow:{version:'delivery-v1',revision:0,policy:{priority:'normal',wip:1,sla_minutes:15,max_repairs:2,min_tests:2},policy_history:[],metrics:{completed_packages:3,rework_count:1,elapsed_seconds:124,escaped_defect_rate:null},columns:['backlog','ready','doing','review','verifying','acceptance','done'].map((id,i)=>({id,name:['待办','就绪','进行中','评审中','验证中','待验收','完成'][i],entry:'输入和依赖齐备',exit:'检查真实产出和相应证据',output:'阶段产物',next:i===6?[]:['doing']})),cards:roles.map((role,i)=>({id:'fixture-run:w1:'+role,role,owner:FALLBACK_TEAM[role].id,owner_name:FALLBACK_TEAM[role].name,collaborators:[],title:names[i],tasks:['按已确认范围推进','保留不受影响的功能'],acceptance:['切换筛选后只显示对应状态的任务'],output:'文档、源码与实际执行记录',gate:i<3?'结构检查':'独立验证',depends_on:i?['fixture-run:w1:'+roles[i-1]]:[],state:i<3?'done':i===3?'review':'ready',blocked:null,blocked_seconds:0,evidence:i<3?'结构化产出已保存':null,lane:'标准',cycle_seconds:30,overdue:false}))}}};
function Fixture(){const [run,setRun]=useState(initial);return <main style={{maxWidth:1100,margin:'24px auto',padding:12}}><DeliveryBoard run={run}/><button onClick={()=>setRun({...run,status:'done'})}>模拟结束任务</button></main>;}
createRoot(document.getElementById('root')!).render(<TooltipProvider><Fixture/></TooltipProvider>);

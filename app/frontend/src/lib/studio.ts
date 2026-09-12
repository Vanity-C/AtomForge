import {invoke} from './sdk';
import type {GeneratedFile} from './agent/codegen';
import type {AgentTeam} from './agentProfiles';
export interface Artifact {js:string;css:string}
export type AgentMode = 'build' | 'team';
export const TEAM_ROLES = [
  {id:'leader',name:'团队领导',alias:'Atlas',nickname:'阿特拉斯',task:'接待需求和反馈，拆解任务、安排阶段与成员，协调调整并对交付负责',greeting:'你好，我是 Atlas。想做什么、哪里需要调整，直接告诉我，我来安排团队推进。',equipment:'调度台 · 决策与协作'},
  {id:'product',name:'产品经理',alias:'Milo',nickname:'米洛',task:'梳理需求、确定优先级，在关键节点和你确认方案',greeting:'嗨，我是 Milo！先聊聊你想解决什么问题？',equipment:'需求清单 · 团队协调'},
  {id:'design',name:'交互设计师',alias:'Luna',nickname:'露娜',task:'设计页面布局、配色和交互，让每一步都清楚好用',greeting:'嗨，我是 Luna！一起把你的想法画出来吧。',equipment:'绘图板 · 配色笔'},
  {id:'architect',name:'技术架构师',alias:'Ollie',nickname:'奥利',task:'规划组件、数据与技术结构，为后续扩展打好基础',greeting:'你好，我是 Ollie。结构交给我，想法尽管提。',equipment:'结构蓝图 · 系统设计'},
  {id:'engineer',name:'应用工程师',alias:'Neo',nickname:'尼奥',task:'编写应用代码、连接数据，把方案变成可运行的产品',greeting:'嗨，我是 Neo！准备好把想法跑起来了吗？',equipment:'开发电脑 · 调试耳机'},
  {id:'qa',name:'测试工程师',alias:'Pip',nickname:'皮普',task:'检查功能和真实交互，发现问题并验证修复结果',greeting:'你好呀，我是 Pip！每个小细节我都会认真检查。',equipment:'放大镜 · 验收清单'},
] as const;
export const agentLabel = (id:string) => {const role=TEAM_ROLES.find(r=>r.id===id);return role?`${role.alias} · ${role.name}`:id;};
export interface TeamOutput {summary?:string;goal?:string;tasks?:string[];acceptance?:string[];items?:string[];issues?:string[];approved?:boolean;verified?:boolean;stages?:{role:string;title:string;tasks:string[];delivery:string;gatekeeper:string}[];adjustments?:{attempt:number;summary:string;items:string[]}[];tests?:{action:string;selector:string;value?:string}[]}
export interface PendingConfirmation {
  id:string;key:string;role:string;title:string;documents:Record<string,TeamOutput>;
  choices:{id:string;question:string;reason:string;recommended:string;options:{id:string;label:string;description:string}[]}[];
  auto:{paused:boolean;deadline:number|null;error?:string};
}
export interface StudioRun {
  agents?:AgentTeam;
  id:string;project_id:number;mode?:'build'|'race'|'team';status:string;stage:string;error:string;server_time?:number;
  events:{stage:string;message:string;at:string;role?:string;recipient?:string;state?:string;kind?:string;output?:TeamOutput}[];
  result:{error_code?:string;resume_stage?:string;pending?:PendingConfirmation;version?:number;summary?:string;draft_files?:GeneratedFile[];team?:Record<string,TeamOutput>;candidates?:{model:string;summary:string;files:GeneratedFile[];artifact:Artifact}[]};
}
export const studioUrl=(id:number,path:string)=>`/api/v1/studio/projects/${id}/${path}`;
export const fetchRun=(id:string)=>invoke<StudioRun>({url:`/api/v1/studio/runs/${id}`});

/** Cloud requests are brokered by the parent with a separate app-user token. */
export async function cloudRequest(slug:string,action:string,data:Record<string,unknown>) {
  const key='atomforge.cloud.session.'+slug;
  if(action==='logout'){localStorage.removeItem(key);return {success:true};}
  const root='/api/v1/cloud/'+encodeURIComponent(slug);
  const collection=encodeURIComponent(String(data.collection||''));
  const id=encodeURIComponent(String(data.id||''));
  const routes:Record<string,[string,string,unknown]>={
    register:['POST',root+'/register',{email:data.email,password:data.password}],
    login:['POST',root+'/login',{email:data.email,password:data.password}],
    me:['GET',root+'/me',undefined],
    list:['GET',root+'/data/'+collection,undefined],
    create:['POST',root+'/data/'+collection,{data:data.data}],
    update:['PUT',root+'/data/'+collection+'/'+id,{data:data.data}],
    remove:['DELETE',root+'/data/'+collection+'/'+id,undefined],
    ai:['POST',root+'/ai/chat',{prompt:data.prompt}],
    checkout:['POST','/api/v1/connections/cloud/'+encodeURIComponent(slug)+'/checkout',undefined],
    payments:['GET','/api/v1/connections/cloud/'+encodeURIComponent(slug)+'/payments',undefined],
  };
  if(!routes[action]) throw Error('不支持的应用操作');
  const [method,url,body]=routes[action];
  const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-App-Token':localStorage.getItem(key)||''},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
  const result=await r.json();
  if(!r.ok) throw Error(typeof result.detail==='string'?result.detail:'应用服务请求失败');
  if(action==='login'||action==='register'){localStorage.setItem(key,result.access_token);return {user:result.user};}
  return result;
}

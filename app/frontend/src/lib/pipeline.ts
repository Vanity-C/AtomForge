import type {StudioRun, TeamOutput} from './studio';

export type PipelineState = 'pending' | 'active' | 'complete' | 'waiting' | 'blocked';
const LEADER_STAGE = {id:'leader',title:'拆解与调度',caption:'先把方向与分工安排好',role:'leader',tasks:['承接需求与最新反馈','制定阶段、任务和负责人','协调专业意见，安排调整与返工'],delivery:'本轮任务分配与阶段计划',gate:'领导把关目标与范围，独立测试把关实际交付',next:'product'};
export const TEAM_PIPELINE = [
  {id:'product',title:'明确需求',caption:'从想法到共识',role:'product',tasks:['理清目标、使用者与核心功能','确定范围和可验证的验收标准','必要时向你确认关键选择'],delivery:'需求清单与验收标准',gate:'需求负责人把关范围；关键选择由你决定',next:'design'},
  {id:'design',title:'设计体验',caption:'让每一步更顺手',role:'design',tasks:['设计页面布局与操作路径','补齐空状态、异常提示和反馈','把视觉与交互方案交给架构伙伴'],delivery:'界面与交互方案',gate:'设计负责人关注使用体验；架构伙伴承接实现方案',next:'architect'},
  {id:'architect',title:'搭好结构',caption:'为实现铺好路',role:'architect',tasks:['划分组件与数据结构','明确实现顺序和技术约束','协调设计方案与开发可行性'],delivery:'技术方案与开发步骤',gate:'架构负责人把关实现方案；必要时由你确认',next:'engineer'},
  {id:'engineer',title:'动手实现',caption:'让想法运行起来',role:'engineer',tasks:['按照已确认方案编写应用','连接交互、状态和数据','根据验收反馈修复实际问题'],delivery:'应用代码与开发自测',gate:'交给测试伙伴独立审查，未通过的代码继续修复',next:'qa'},
  {id:'qa',title:'独立验收',caption:'交付前，再走一遍',role:'qa',tasks:['对照需求审查实际代码','运行构建与核心浏览器交互测试','发现问题退回修复，通过后才交付'],delivery:'验收报告与可运行版本',gate:'测试伙伴独立把关；审查与浏览器测试全部通过才保存',next:'release'},
] as const;

const BUILD_PIPELINE = [
  {id:'plan',title:'梳理计划',caption:'确定本轮目标',role:'engineer',tasks:['理解本轮需求','拆分任务与验收标准'],delivery:'任务计划',gate:'先明确需求范围和检查标准',next:'code'},
  {id:'code',title:'实现应用',caption:'完成代码与交互',role:'engineer',tasks:['增量修改应用代码','保留未涉及的功能','生成开发自测步骤'],delivery:'应用代码与测试步骤',gate:'工程师完成实现，再进入实际构建与自测',next:'test'},
  {id:'test',title:'构建自测',caption:'运行起来，验证它',role:'engineer',tasks:['编译项目与依赖','运行浏览器交互测试','根据反馈自动修复'],delivery:'构建与自测结果',gate:'工程师模式执行开发自测，不包含独立测试角色审查',next:'save'},
  {id:'save',title:'保存交付',caption:'留下可继续的版本',role:'engineer',tasks:['确认检查结果通过','保存代码与版本','更新运行预览'],delivery:'可运行版本',gate:'只有验证通过的结果才能成为正式版本',next:'release'},
] as const;

export function pipelineStages(run:StudioRun|null, mode:'team'|'build'='team') {
  const leadership=!run||!!run.agents?.leader||!!run.result.team?.leader||run.events.some(e=>e.role==='leader');
  const plan=run?.result.team?.leader;
  const planned=plan?.stages?.flatMap(stage=>{
    const base=TEAM_PIPELINE.find(item=>item.id===stage.role);
    return base?[{...base,...stage,id:stage.role,caption:'团队领导安排的本轮工作',gate:`由${stage.gatekeeper==='qa'?'独立测试岗位':'指定负责人'}把关 · ${stage.delivery}`}]:[];
  });
  const specialists=planned?.length===5?planned:TEAM_PIPELINE.map(stage=>({...stage,gatekeeper:stage.id==='engineer'||stage.id==='qa'?'qa':leadership?'leader':stage.role}));
  const definitions=mode==='team'?(leadership?[{...LEADER_STAGE,gatekeeper:'leader'},...specialists]:specialists).map((stage,index,all)=>({...stage,next:all[index+1]?.id||'release'})):
    BUILD_PIPELINE.map(stage=>({...stage,role:stage.id==='plan'&&leadership?'leader':stage.role,gatekeeper:stage.id==='plan'&&leadership?'leader':'engineer'}));
  const active=run?.status==='running';
  const terminal=!!run&&['error','interrupted','cancelled'].includes(run.status);
  const reversed=[...(run?.events||[])].reverse();
  const latest=reversed.find(e=>e.role&&!e.kind?.startsWith('tool_'))||reversed[0];
  const lastWork=reversed.find(e=>['code','repair','test'].includes(e.stage)&&!e.kind?.startsWith('tool_'));
  const repairing=!!active&&(run?.stage==='repair'||(lastWork?.stage==='repair'&&(latest?.role==='engineer'||latest?.role==='leader'||latest===lastWork)));
  const buildStage=terminal?reversed.find(e=>['plan','code','repair','test','build','save','runner.build_and_test'].includes(e.stage))?.stage:run?.stage;
  const current=mode==='team'?(latest?.role==='leader'&&latest.kind==='handoff'&&latest.recipient&&latest.recipient!=='user'?latest.recipient:repairing?'engineer':latest?.role||(leadership?'leader':'product')):
    buildStage==='save'?'save':['test','build','runner.build_and_test'].includes(buildStage||'')?'test':buildStage==='plan'?'plan':'code';
  const buildOrder=['plan','code','test','save'];
  return definitions.map(definition=>{
    const roleEvents=run?.events.filter(e=>mode==='team'?e.role===definition.role:e.stage===definition.id)||[];
    const last=[...roleEvents].reverse().find(e=>!e.kind?.startsWith('tool_'));
    let output:TeamOutput|undefined=mode==='team'?run?.result.team?.[definition.id]:undefined;
    if(mode==='build'&&definition.id==='plan'){
      const plan=run?.events.find(e=>e.stage==='plan'&&e.message.startsWith('{'));
      try{output=JSON.parse(plan?.message||'null')||undefined;}catch{/* No structured plan was recorded. */}
    }
    let state:PipelineState='pending';
    if(mode==='team'){
      if(definition.id==='qa'?output?.verified===true:!!output||last?.state==='done')state='complete';
    }else if(run?.status==='done'||(active&&buildOrder.indexOf(definition.id)<buildOrder.indexOf(current)))state='complete';
    if(active&&definition.id===current&&(state!=='complete'||last?.state==='running'||last?.state==='recovering'))state='active';
    if(active&&definition.id===current&&definition.id==='engineer'&&repairing)state='active';
    if(mode==='team'&&repairing&&definition.id==='qa')state='waiting';
    if(run?.status==='awaiting_input'&&definition.role===run.result.pending?.role)state='waiting';
    if(terminal&&definition.id===current&&!(definition.id==='qa'&&output?.verified))state='blocked';
    // A terminal save failure must not falsely mark the whole delivery as complete.
    if(mode==='build'&&terminal){
      if(definition.id==='plan'&&output)state='complete';
      if(definition.id==='code'&&run?.result.draft_files?.length&&current!=='code')state='complete';
    }
    return {...definition,state,output,last,repairing};
  });
}

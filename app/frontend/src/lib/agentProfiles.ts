import {TEAM_ROLES} from './studio';

export type AgentRole = 'leader'|'product'|'design'|'architect'|'engineer'|'qa';
export interface AgentProfile {id:string;role:AgentRole;name:string;title:string;responsibilities:string;personality:string;greeting:string;avatar:string;avatar_style:AgentRole}
export interface AgentGroup {id:string;name:string;description:string;color:string;member_ids:string[]}
export interface AgentConfiguration {agents:AgentProfile[];active:Record<AgentRole,string>;teams:AgentGroup[];active_team_id:string;revision:number;defaults?:AgentConfiguration}
/** Stage assignments coexist with member:<id> entries in new immutable run snapshots. */
export type AgentTeam = Record<string,AgentProfile>;
export const ROLE_LABELS:Record<AgentRole,string>={leader:'领导',product:'产品',design:'设计',architect:'架构',engineer:'开发',qa:'测试'};
export const FALLBACK_TEAM:AgentTeam=Object.fromEntries(TEAM_ROLES.map(r=>[r.id,{id:'default-'+r.id,role:r.id,name:r.alias,title:r.name,responsibilities:r.task,personality:r.equipment,greeting:r.greeting,avatar:'',avatar_style:r.id}]));
const ASSIGNMENT_ORDER:AgentRole[]=['product','design','architect','engineer','qa','leader'];
/** Initial roster only; a saved default-team is as customizable as any other team. */
export const DEFAULT_GROUP:AgentGroup={id:'default-team',name:'默认团队',description:'六位默契伙伴，从想法到交付全程协作。',color:'sage',member_ids:ASSIGNMENT_ORDER.map(role=>'default-'+role)};

/** Compatibility for an already cached or older server response. */
export function normalizeAgentConfiguration(config:AgentConfiguration):AgentConfiguration {
  if(config.teams?.length){
    if(config.teams.some(group=>group.id===config.active_team_id))return config;
    // Repair a missing selection without replacing an already customized roster.
    return {...config,active_team_id:(config.teams.find(group=>group.id===DEFAULT_GROUP.id)||config.teams[0]).id};
  }
  const original=[...new Set(ASSIGNMENT_ORDER.map(role=>config.active[role]).filter(Boolean))];
  const custom=original.some(id=>!id.startsWith('default-'));
  const migrated:AgentGroup={id:'preserved-team',name:'我的原团队',description:'保留升级前的成员安排。',color:'sky',member_ids:original};
  return {...config,teams:[{...DEFAULT_GROUP,member_ids:[...DEFAULT_GROUP.member_ids]},...(custom?[migrated]:[])],active_team_id:custom?migrated.id:DEFAULT_GROUP.id};
}
export const activeGroup=(config:AgentConfiguration):AgentGroup=>config.teams?.find(group=>group.id===config.active_team_id)||config.teams?.[0]||DEFAULT_GROUP;
export function groupMembers(config:AgentConfiguration,group:AgentGroup=activeGroup(config)):AgentProfile[] {
  const agents=new Map(config.agents.map(agent=>[agent.id,agent]));
  return [...new Set(group.member_ids)].map(id=>agents.get(id)).filter((agent):agent is AgentProfile=>!!agent);
}

export function activeTeam(config:AgentConfiguration):AgentTeam {
  const members=groupMembers(config);
  if(!members.length)return {};
  const stages:AgentTeam={};
  const loads=new Map(members.map(agent=>[agent.id,0]));
  for(const role of ASSIGNMENT_ORDER){
    const agent=members.find(member=>member.role===role);
    if(agent){stages[role]=agent;loads.set(agent.id,loads.get(agent.id)!+1);}
  }
  for(const role of ASSIGNMENT_ORDER){
    if(stages[role])continue;
    const agent=members.reduce((least,member)=>loads.get(member.id)!<loads.get(least.id)!?member:least);
    stages[role]=agent;loads.set(agent.id,loads.get(agent.id)!+1);
  }
  return {...stages,...Object.fromEntries(members.map(agent=>[memberTarget(agent.id),agent]))};
}

export const memberTarget=(id:string)=>`member:${id}`;
export const displayAgent=(agent:AgentProfile,id:string=agent.role)=>({id,role:agent.role,alias:agent.name,name:agent.title,nickname:'',task:agent.responsibilities,greeting:agent.greeting,equipment:agent.personality,profile:agent});

/** Never present a selected member twice when they cover several execution stages. */
export function teamRoster(team:AgentTeam){
  const entries=Object.entries(team).filter(([,agent])=>!!agent);
  const roster=entries.filter(([id])=>id.startsWith('member:'));
  const seen=new Set<string>();
  return (roster.length?roster:entries).filter(([,agent])=>{if(seen.has(agent.id))return false;seen.add(agent.id);return true;}).map(([id,agent])=>displayAgent(agent,id));
}
export function teamStages(team:AgentTeam){
  const legacy=!Object.keys(team).some(id=>id.startsWith('member:'));
  return TEAM_ROLES.flatMap(({id})=>{
    const agent=team[id]||(legacy&&id==='leader'?FALLBACK_TEAM.leader:undefined);
    return agent?[displayAgent(agent,id)]:[];
  });
}
export function conversationTarget(team:AgentTeam,target:string):string {
  if(target==='all'||target==='user')return target;
  const agent=team[target];
  return agent&&team[memberTarget(agent.id)]?memberTarget(agent.id):target;
}

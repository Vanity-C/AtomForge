import {TEAM_ROLES} from './studio';
export type AgentRole = 'leader'|'product'|'design'|'architect'|'engineer'|'qa';
export interface AgentProfile {id:string;role:AgentRole;name:string;title:string;responsibilities:string;personality:string;greeting:string;avatar:string;avatar_style:AgentRole}
export interface AgentConfiguration {agents:AgentProfile[];active:Record<AgentRole,string>;revision:number;defaults?:AgentConfiguration}
export type AgentTeam = Record<string,AgentProfile>;
export const ROLE_LABELS:Record<AgentRole,string>={leader:'领导',product:'产品',design:'设计',architect:'架构',engineer:'开发',qa:'测试'};
export const FALLBACK_TEAM:AgentTeam=Object.fromEntries(TEAM_ROLES.map(r=>[r.id,{id:'default-'+r.id,role:r.id,name:r.alias,title:r.name,responsibilities:r.task,personality:r.equipment,greeting:r.greeting,avatar:'',avatar_style:r.id}]));
export const activeTeam=(config:AgentConfiguration):AgentTeam=>Object.fromEntries(Object.entries(config.active).map(([role,id])=>[role,config.agents.find(a=>a.id===id)!]));
export const displayAgent=(a:AgentProfile)=>({id:a.role,alias:a.name,name:a.title,nickname:'',task:a.responsibilities,greeting:a.greeting,equipment:a.personality,profile:a});

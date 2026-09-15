import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64');
const studio=await readFile(new URL('../src/lib/studio.ts',import.meta.url),'utf8');
const roles=moduleUrl(studio.slice(studio.indexOf('export const TEAM_ROLES'),studio.indexOf('export const agentLabel')));
const source=await readFile(new URL('../src/lib/agentProfiles.ts',import.meta.url),'utf8');
const {engineerTeam,activeTeam,activeGroup,groupMembers,teamRoster,teamStages,conversationTarget,normalizeAgentConfiguration,FALLBACK_TEAM,DEFAULT_GROUP}=await import(moduleUrl(source.replace("'./studio'",JSON.stringify(roles))));
const agents=Object.values(FALLBACK_TEAM);
const config=(members,extra=[])=>({agents:[...agents,...extra],active:Object.fromEntries(agents.map(agent=>[agent.role,agent.id])),teams:[DEFAULT_GROUP,{id:'custom',name:'精简团队',description:'',color:'blue',member_ids:members}],active_team_id:'custom',revision:3});

test('leaders are displayed first without dropping or reordering other selected members',()=>{
  const value=config(['default-qa','default-design','default-leader','default-engineer']);
  assert.equal(DEFAULT_GROUP.member_ids[0],'default-leader');
  assert.deepEqual(groupMembers(value).map(person=>person.id),['default-leader','default-qa','default-design','default-engineer']);
  assert.equal(teamRoster(activeTeam(value))[0].profile.id,'default-leader');
});

test('a one-person team covers every stage without inventing unselected colleagues',()=>{
  const value=config(['default-design']);
  const snapshot=activeTeam(value);
  assert.deepEqual(teamRoster(snapshot).map(member=>member.profile.id),['default-design']);
  assert.equal(teamStages(snapshot).length,6);
  assert.ok(Object.values(snapshot).every(agent=>agent.id==='default-design'));
  assert.equal(snapshot.engineer.role,'design');
  assert.equal(conversationTarget(snapshot,'leader'),'member:default-design');
  assert.equal(conversationTarget(snapshot,'qa'),'member:default-design');
});

test('same-profession members remain separate chat targets and share uncovered stages evenly',()=>{
  const second={...FALLBACK_TEAM.engineer,id:'second-engineer',name:'Lin'};
  const snapshot=activeTeam(config(['default-engineer',second.id],[second]));
  assert.deepEqual(teamRoster(snapshot).map(member=>[member.id,member.role]),[['member:default-engineer','engineer'],['member:second-engineer','engineer']]);
  assert.deepEqual(Object.fromEntries(teamStages(snapshot).map(stage=>[stage.id,stage.profile.id])),{leader:'second-engineer',product:'second-engineer',design:'default-engineer',architect:'second-engineer',engineer:'default-engineer',qa:'default-engineer'});
  assert.equal(conversationTarget(snapshot,'member:second-engineer'),'member:second-engineer');
});

test('roster includes selected members with no primary stage assignment in chosen order',()=>{
  const extra=Array.from({length:7},(_,index)=>({...FALLBACK_TEAM.engineer,id:'engineer-'+index}));
  const snapshot=activeTeam(config(extra.map(agent=>agent.id),extra));
  assert.deepEqual(teamRoster(snapshot).map(member=>member.profile.id),extra.map(agent=>agent.id));
  assert.equal(teamStages(snapshot).length,6);
});

test('legacy snapshots preserve their profile identities and stage targets',()=>{
  const legacy={engineer:{...FALLBACK_TEAM.engineer,name:'旧版工程师'},qa:{...FALLBACK_TEAM.qa,name:'旧版测试员'}};
  assert.deepEqual(teamRoster(legacy).map(member=>member.alias),['旧版工程师','旧版测试员']);
  assert.equal(teamStages(legacy).find(stage=>stage.id==='leader').profile.id,'default-leader');
  assert.equal(conversationTarget(legacy,'engineer'),'engineer');
});

test('an explicit member roster cannot acquire a default leader through display fallback',()=>{
  const snapshot={'member:default-qa':FALLBACK_TEAM.qa};
  assert.deepEqual(teamStages(snapshot),[]);
  assert.deepEqual(teamRoster(snapshot).map(member=>member.profile.id),['default-qa']);
});

test('old custom selections migrate to their own team without resetting revision or profiles',()=>{
  const custom={...FALLBACK_TEAM.engineer,id:'custom-engineer'};
  const value={agents:[...agents,custom],active:{...config([]).active,engineer:custom.id},revision:8};
  const normalized=normalizeAgentConfiguration(value);
  assert.equal(normalized.revision,8);
  assert.equal(activeGroup(normalized).id,'preserved-team');
  assert.ok(groupMembers(normalized).some(agent=>agent.id===custom.id));
  assert.equal(normalized.agents,value.agents);
  assert.equal(normalized.teams[0].id,'default-team');
});

test('initial default team starts with six companions and read helpers do not mutate configuration',()=>{
  const value={...config([]),active_team_id:'default-team'};
  const before=JSON.stringify(value);
  assert.equal(teamRoster(activeTeam(value)).length,6);
  assert.equal(JSON.stringify(value),before);
});

test('an edited default team uses its saved ordered roster without restoring initial companions',()=>{
  const partner={...FALLBACK_TEAM.engineer,id:'new-partner',name:'新伙伴'};
  const value={...config([],[partner]),teams:[{...DEFAULT_GROUP,member_ids:[partner.id,'default-design']}],active_team_id:'default-team'};
  const normalized=normalizeAgentConfiguration(value);
  assert.equal(normalized,value);
  assert.deepEqual(groupMembers(normalized).map(agent=>agent.id),[partner.id,'default-design']);
  const snapshot=activeTeam(normalized);
  assert.deepEqual(teamRoster(snapshot).map(member=>member.profile.id),[partner.id,'default-design']);
  assert.ok(Object.values(snapshot).every(agent=>[partner.id,'default-design'].includes(agent.id)));
  const profileRestored={...normalized,agents:normalized.agents.map(agent=>({...agent,name:agent.id}))};
  assert.deepEqual(groupMembers(normalizeAgentConfiguration(profileRestored)).map(agent=>agent.id),[partner.id,'default-design']);
  assert.equal(DEFAULT_GROUP.member_ids.length,6);
});

test('repairing a cached missing team selection preserves a customized default roster',()=>{
  for(const active_team_id of [undefined,'deleted-team']){
    const savedDefault={...DEFAULT_GROUP,name:'我的日常团队',member_ids:['default-qa']};
    const value={...config([]),teams:[savedDefault],active_team_id};
    const normalized=normalizeAgentConfiguration(value);
    assert.equal(normalized.teams,value.teams);
    assert.equal(normalized.active_team_id,'default-team');
    assert.deepEqual(teamRoster(activeTeam(normalized)).map(member=>member.profile.id),['default-qa']);
    assert.equal(normalized.revision,value.revision);
  }
});


test('engineer mode uses exactly one real engineer and falls back when the team has none',()=>{
  const solo=engineerTeam(activeTeam(config(['default-leader','default-engineer','default-qa'])));
  assert.deepEqual(teamRoster(solo).map(m=>m.profile.id),['default-engineer']);
  assert.deepEqual(teamStages(solo).map(m=>m.id),['engineer']);
  const fallback={...FALLBACK_TEAM.engineer,name:'My engineer'};
  assert.equal(engineerTeam(activeTeam(config(['default-design'])),fallback).engineer.name,'My engineer');
});

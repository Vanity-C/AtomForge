import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {invoke,onAuthChange,readToken,errorMessage} from '@/lib/sdk';
import {activeTeam,engineerTeam,FALLBACK_TEAM,normalizeAgentConfiguration,teamRoster,teamStages,type AgentConfiguration,type AgentTeam} from '@/lib/agentProfiles';

const Context=createContext<{config?:AgentConfiguration;team:AgentTeam;loading:boolean;error:string;refresh:()=>Promise<void>;save:(value:AgentConfiguration)=>Promise<AgentConfiguration>}>({team:FALLBACK_TEAM,loading:false,error:'',refresh:async()=>{},save:async value=>value});
export function AgentProvider({children}:{children:ReactNode}) {
  const [config,setConfig]=useState<AgentConfiguration>();
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const serial=useRef(0);
  const token=useRef('');
  const refresh=useCallback(async()=>{
    const current=readToken();const request=++serial.current;
    if(token.current!==current){token.current=current;setConfig(undefined);}
    if(!current){setLoading(false);setError('');return;}
    setLoading(true);setError('');
    try {const value=await invoke<AgentConfiguration>({url:'/api/v1/studio/agents'});if(request===serial.current)setConfig(normalizeAgentConfiguration(value));}
    catch(e){if(request===serial.current)setError(errorMessage(e,'智能体设置暂未加载'));}
    finally{if(request===serial.current)setLoading(false);}
  },[]);
  useEffect(()=>{void refresh();const off=onAuthChange(()=>{if(readToken()!==token.current)void refresh();});return()=>{off();serial.current++;};},[refresh]);
  const save=async(value:AgentConfiguration)=>{
    const current=readToken();
    const result=normalizeAgentConfiguration(await invoke<AgentConfiguration>({url:'/api/v1/studio/agents',method:'PUT',data:{agents:value.agents,active:value.active,teams:value.teams,active_team_id:value.active_team_id,revision:value.revision}}));
    if(current===readToken()){serial.current++;setConfig(result);setLoading(false);setError('');}
    return result;
  };
  return <Context.Provider value={{config,team:config?activeTeam(config):FALLBACK_TEAM,loading,error,refresh,save}}>{children}</Context.Provider>;
}
export const useAgents=()=>useContext(Context);
export function useAgentTeam(snapshot?:AgentTeam|null){const {team}=useAgents();return snapshot&&Object.keys(snapshot).length?snapshot:team;}
export function useTeam(snapshot?:AgentTeam|null){return teamRoster(useAgentTeam(snapshot));}
/** Stage-based consumers retain execution roles while showing their real assigned person. */
export function useStageTeam(snapshot?:AgentTeam|null){return teamStages(useAgentTeam(snapshot));}
export function useModeTeam(mode:'build'|'team', snapshot?:AgentTeam|null){
  const team=useAgentTeam(snapshot);
  const {config}=useAgents();
  return mode==='team'?team:engineerTeam(team,config?.agents.find(agent=>agent.id==='default-engineer'));
}

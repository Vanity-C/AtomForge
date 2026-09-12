import type {AgentProfile,AgentTeam} from './agentProfiles';
export type ConversationDetail = {
  agent?:AgentProfile;
  call_id?: string; tool?: string; state?: string; duration_ms?: number;
  inputs?: unknown; output?: unknown; plan?: string[];
  diagnostic?: string;
};
export type ConversationMessage = {
  team?:AgentTeam;
  id: number; run_id?: string; sender: string; recipient: string; kind: string;
  content: string; detail: ConversationDetail; created: string;
};
export type ConversationStep = {message: ConversationMessage; result?: ConversationMessage};
export type ConversationReply = {id: number; sender: string; runId: string; messages: ConversationMessage[]; steps: ConversationStep[]; answer?: ConversationMessage};

/** Only link structured tool output to files that exist in the current project. */
export function currentOutputFiles(output: unknown, available: readonly string[]): string[] {
  if (!output || typeof output !== 'object' || !('files' in output) || !Array.isArray(output.files)) return [];
  const paths = output.files.map((file: unknown) => typeof file === 'string' ? file : file && typeof file === 'object' && 'path' in file ? file.path : null);
  return [...new Set(paths.filter((path): path is string => typeof path === 'string' && available.includes(path)))];
}

/** Pair tools before grouping: their result may arrive after another role's event. */
export function groupConversation(items: ConversationMessage[]): ConversationReply[] {
  const toolKey = (m: ConversationMessage) => `${m.run_id || ''}:${m.sender}:${m.detail.call_id}`;
  const starts = new Set(items.filter(m => m.kind === 'tool_start' && m.detail.call_id).map(toolKey));
  const results = new Map(items.filter(m => m.kind === 'tool_result' && m.detail.call_id).map(m => [toolKey(m), m]));
  const replies: ConversationReply[] = [];
  for (const message of items) {
    if (message.kind === 'tool_result' && message.detail.call_id && starts.has(toolKey(message))) continue;
    let reply = replies.at(-1);
    const previous = reply?.messages.at(-1);
    if (!reply || message.sender === 'user' || reply.sender !== message.sender || reply.runId !== (message.run_id || '') || previous?.kind === 'summary' || previous?.kind === 'chat') {
      reply = {id: message.id, sender: message.sender, runId: message.run_id || '', messages: [], steps: []};
      replies.push(reply);
    }
    reply.messages.push(message);
    reply.steps.push({message, result: message.kind === 'tool_start' && message.detail.call_id ? results.get(toolKey(message)) : undefined});
  }
  for (const reply of replies) {
    // Keep the actual role response visible, not a generated synopsis of the trace.
    const latestFirst = [...reply.messages].reverse();
    reply.answer = latestFirst.find(m => ['summary', 'chat', 'result', 'confirmation', 'error'].includes(m.kind))
      || latestFirst.find(m => ['activity', 'handoff'].includes(m.kind));
    if (reply.answer) reply.steps = reply.steps.filter(s => s.message.id !== reply.answer?.id);
  }
  return replies;
}

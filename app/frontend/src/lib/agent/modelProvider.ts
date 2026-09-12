/** DeepSeek generation profiles and authenticated incremental job client. */
import { invoke } from '@/lib/sdk';

export interface ModelOption { id: string; label: string; provider: string; traits: string[]; note: string; }
export interface GenerationProfile { provider: string; model: string; temperaturePct: number; autoPreview: boolean; }
export const DEFAULT_PROFILE: GenerationProfile = { provider: 'deepseek', model: 'deepseek-flash', temperaturePct: 35, autoPreview: true };
export const MODEL_CATALOGUE: ModelOption[] = [
  { id: 'deepseek-flash', label: 'DeepSeek Flash', provider: 'deepseek', traits: ['快速', '默认'], note: '适合应用生成和多轮修改' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'deepseek', traits: ['复杂需求'], note: '用于更复杂的应用设计与代码生成' },
];
export function findModel(id: string): ModelOption { return MODEL_CATALOGUE.find(m => m.id === id) ?? MODEL_CATALOGUE[0]; }
export interface ChatTurn { role: 'system' | 'user' | 'assistant'; content: string; }
export interface StreamHandlers { onChunk?: (delta: string, aggregated: string) => void; onComplete?: (full: string) => void; }
interface JobUpdate { status: 'running' | 'done' | 'error' | 'cancelled'; delta: string; offset: number; error: string; }

export async function runTextModel(messages: ChatTurn[], profile: GenerationProfile, handlers: StreamHandlers = {}, signal?: AbortSignal): Promise<string> {
  let id = '';
  let complete = false;
  const deadline = Date.now() + 330_000;
  const check = () => {
    if (signal?.aborted) throw new Error('已取消生成，上一版本保持不变');
    if (Date.now() > deadline) throw new Error('生成超时，请重试');
  };
  try {
    check();
    const job = await invoke<{id: string}>({ url: '/api/v1/af-generation/jobs', method: 'POST', data: {
      messages, model: findModel(profile.model).id, temperature: profile.temperaturePct / 100, max_tokens: 12000,
    } });
    id = job.id;
    let offset = 0;
    let text = '';
    while (true) {
      check();
      const update = await invoke<JobUpdate>({ url: `/api/v1/af-generation/jobs/${id}?offset=${offset}` });
      check();
      if (update.delta) { text += update.delta; handlers.onChunk?.(update.delta, text); }
      offset = update.offset;
      if (update.status === 'error' || update.status === 'cancelled') throw new Error(update.error || '生成失败，请重试');
      if (update.status === 'done') { complete = true; handlers.onComplete?.(text); return text; }
      await new Promise(resolve => setTimeout(resolve, 600));
    }
  } finally {
    if (id && !complete) {
      await invoke({url: `/api/v1/af-generation/jobs/${id}`, method: 'DELETE'}).catch(() => undefined);
    }
  }
}

/**
 * Data access layer for AtomForge.
 *
 * All project data is owned by AtomForge's own account system: reads and writes
 * go through the `/api/v1/af/*` routes, which enforce ownership server-side by
 * the signed-in AtomForge user. The public share payload is the only anonymous
 * read path.
 */
import { invoke } from '@/lib/sdk';
import {projectCollection, projectSession} from '@/lib/projectCollection';
import type { GeneratedFile } from '@/lib/agent/codegen';
import { languageOf } from '@/lib/agent/codegen';
import { DEFAULT_PROFILE, findModel, type GenerationProfile } from '@/lib/agent/modelProvider';

export interface ProjectRecord {
  role?: 'owner'|'editor'|'viewer';
  id: number;
  name: string;
  description: string;
  initial_prompt: string;
  agent_mode: 'build' | 'team';
  template: string;
  status: string;
  current_version: number;
  entry_file: string;
  share_slug: string;
  is_public: boolean;
  view_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface FileRecord extends GeneratedFile {
  id: number;
  project_id: number;
  version: number;
}

export interface VersionRecord {
  id: number;
  project_id: number;
  version: number;
  summary: string;
  prompt: string;
  files_snapshot: string;
  source: string;
  created_at?: string;
}

export interface MessageRecord {
  id: number;
  project_id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  phase: string;
  version: number;
  model: string;
  created_at?: string;
}

/* ------------------------------------------------------------------ projects */

export async function listProjects(): Promise<ProjectRecord[]> {
  const res = await invoke<{ items: ProjectRecord[] }>({ url: '/api/v1/af/projects' });
  return res.items ?? [];
}

export async function getProject(id: number): Promise<ProjectRecord> {
  const session = projectSession();
  const readRevision = projectCollection.beginRead(id, session);
  try {
    const res = await invoke<{ project: ProjectRecord }>({ url: `/api/v1/af/projects/${id}` });
    projectCollection.upsert(res.project, session, readRevision);
    return res.project;
  } catch (error) {
    if ([403, 404].includes((error as {status?: number})?.status || 0)) projectCollection.remove(id, session, readRevision);
    throw error;
  }
}

export interface ProjectThumbnail {
  status: 'ready' | 'empty' | 'unbuilt' | 'unavailable' | 'changed';
  version: number;
  src?: string;
}

export async function getProjectThumbnail(id: number): Promise<ProjectThumbnail> {
  return invoke<ProjectThumbnail>({url: `/api/v1/af/projects/${id}/thumbnail`, timeoutMs: 150000});
}

export async function createProject(input: {
  name: string;
  description: string;
  initialPrompt: string;
  agentMode?: 'build' | 'team';
}): Promise<ProjectRecord> {
  const session = projectSession();
  const res = await invoke<{ project: ProjectRecord }>({
    url: '/api/v1/af/projects',
    method: 'POST',
    data: {
      name: input.name,
      description: input.description,
      initial_prompt: input.initialPrompt,
      agent_mode: input.agentMode || 'build',
    },
  });
  projectCollection.upsert(res.project, session);
  return res.project;
}

export async function updateProject(
  id: number,
  data: Partial<Pick<ProjectRecord, 'name' | 'description' | 'status' | 'entry_file' | 'is_public'>>,
): Promise<ProjectRecord> {
  const session = projectSession();
  const res = await invoke<{ project: ProjectRecord }>({
    url: `/api/v1/af/projects/${id}`,
    method: 'PATCH',
    data: data as Record<string, unknown>,
  });
  projectCollection.upsert(res.project, session);
  return res.project;
}

export async function deleteProject(id: number): Promise<void> {
  const session = projectSession();
  await invoke({ url: `/api/v1/af/projects/${id}`, method: 'DELETE' });
  projectCollection.remove(id, session);
}

/* --------------------------------------------------------------------- files */

export async function listFiles(projectId: number): Promise<FileRecord[]> {
  const res = await invoke<{ items: FileRecord[] }>({
    url: `/api/v1/af/projects/${projectId}/files`,
  });
  return res.items ?? [];
}

/**
 * Replace the whole file set of a project; the backend also writes a version
 * snapshot. Returns the new version number.
 */
export async function commitFiles(
  projectId: number,
  files: GeneratedFile[],
  meta: { summary: string; prompt: string; source: string; expectedVersion?:number },
): Promise<number> {
  const session = projectSession();
  const res = await invoke<{ version: number; project: ProjectRecord }>({
    url: `/api/v1/af/projects/${projectId}/files`,
    method: 'POST',
    data: {
      files: files.map((f) => ({
        path: f.path,
        content: f.content,
        language: f.language || languageOf(f.path),
      })),
      summary: meta.summary.slice(0, 500),
      prompt: meta.prompt.slice(0, 2000),
      source: meta.source,
      expected_version:meta.expectedVersion,
    },
  });
  projectCollection.upsert(res.project, session);
  return res.version;
}

/* ------------------------------------------------------------------ versions */

export async function listVersions(projectId: number): Promise<VersionRecord[]> {
  const res = await invoke<{ items: VersionRecord[] }>({
    url: `/api/v1/af/projects/${projectId}/versions`,
  });
  return res.items ?? [];
}

export function parseSnapshot(snapshot: string): GeneratedFile[] {
  try {
    const parsed = JSON.parse(snapshot);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string')
      .map((f) => ({
        path: f.path,
        language: f.language || languageOf(f.path),
        content: f.content,
      }));
  } catch {
    return [];
  }
}

/** Roll back to a snapshot; the backend commits it as a new version. */
export async function rollbackToVersion(
  projectId: number,
  version: VersionRecord,
): Promise<number> {
  const session = projectSession();
  const res = await invoke<{ version: number; project: ProjectRecord }>({
    url: `/api/v1/af/projects/${projectId}/rollback`,
    method: 'POST',
    data: { version_id: version.id },
  });
  projectCollection.upsert(res.project, session);
  return res.version;
}

/* ------------------------------------------------------------------ messages */

export async function listMessages(projectId: number): Promise<MessageRecord[]> {
  const res = await invoke<{ items: MessageRecord[] }>({
    url: `/api/v1/af/projects/${projectId}/messages`,
  });
  return res.items ?? [];
}

export async function addMessage(input: {
  projectId: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  phase?: string;
  version?: number;
  model?: string;
}): Promise<MessageRecord> {
  const res = await invoke<{ message: MessageRecord }>({
    url: `/api/v1/af/projects/${input.projectId}/messages`,
    method: 'POST',
    data: {
      role: input.role,
      content: input.content,
      phase: input.phase ?? 'done',
      version: input.version ?? 0,
      model: input.model ?? '',
    },
  });
  return res.message;
}

/* ------------------------------------------------------------------ settings */

interface SettingsPayload {
  provider: string;
  model: string;
  temperature_pct: number;
  auto_preview: boolean;
}

function toProfile(payload?: SettingsPayload): GenerationProfile {
  if (!payload) return { ...DEFAULT_PROFILE };
  return {
    provider: payload.provider || findModel(payload.model).provider,
    model: findModel(payload.model).id,
    temperaturePct:
      typeof payload.temperature_pct === 'number'
        ? payload.temperature_pct
        : DEFAULT_PROFILE.temperaturePct,
    autoPreview: payload.auto_preview ?? DEFAULT_PROFILE.autoPreview,
  };
}

/** Read the caller's generation profile (created on first use server-side). */
export async function loadProfile(): Promise<GenerationProfile> {
  const res = await invoke<{ settings: SettingsPayload }>({ url: '/api/v1/af/settings' });
  return toProfile(res.settings);
}

export async function saveProfile(profile: GenerationProfile): Promise<GenerationProfile> {
  const res = await invoke<{ settings: SettingsPayload }>({
    url: '/api/v1/af/settings',
    method: 'PUT',
    data: {
      provider: profile.provider,
      model: profile.model,
      temperature_pct: profile.temperaturePct,
      auto_preview: profile.autoPreview,
    },
  });
  return toProfile(res.settings);
}

/* --------------------------------------------------------------------- share */

export async function enableShare(project: ProjectRecord): Promise<string> {
  const session = projectSession();
  const res = await invoke<{ project: ProjectRecord }>({
    url: `/api/v1/af/projects/${project.id}/share`,
    method: 'POST',
  });
  projectCollection.upsert(res.project, session);
  return res.project.share_slug;
}

export async function disableShare(project: ProjectRecord): Promise<void> {
  const session = projectSession();
  const res = await invoke<{project: ProjectRecord}>({ url: `/api/v1/af/projects/${project.id}/share`, method: 'DELETE' });
  projectCollection.upsert(res.project, session);
}

export interface SharedPayload {
  name: string;
  description: string;
  entry_file: string;
  current_version: number;
  view_count: number;
  updated_at: string;
  files: GeneratedFile[];
}

/** Fetch a publicly shared project without any authentication. */
export async function fetchSharedProject(slug: string): Promise<SharedPayload> {
  const payload = await invoke<SharedPayload>({
    url: `/api/v1/share/${slug}`,
    auth: false,
  });
  return { ...payload, files: payload.files ?? [] };
}

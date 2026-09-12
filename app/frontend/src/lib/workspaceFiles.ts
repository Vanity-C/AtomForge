import type {GeneratedFile} from './agent/codegen';
import type {StudioRun} from './studio';

/** Keep unsaved editor text attached to the saved file, even as a run updates. */
export function workspaceFiles(saved: GeneratedFile[], run: StudioRun | null, choice: {runId: string; source: 'saved' | 'draft'} | null, editing: boolean) {
  const drafts = run?.status !== 'done' ? run?.result.draft_files ?? [] : [];
  const hasDraft = drafts.length > 0;
  const source = choice?.runId === run?.id ? choice?.source : undefined;
  const showingDraft = hasDraft && !editing && (source !== 'saved' || saved.length === 0);
  return {files: showingDraft ? drafts : saved, hasDraft, showingDraft};
}

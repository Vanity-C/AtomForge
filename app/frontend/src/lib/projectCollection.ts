import {cachedUser, errorMessage, invoke, onAuthChange, readToken} from '@/lib/sdk';
import type {ProjectRecord} from '@/lib/projectStore';

interface Snapshot {
  projects: ProjectRecord[];
  loaded: boolean;
  refreshing: boolean;
  error: string;
  stale: boolean;
}

interface Options {
  session: () => string;
  fetchProjects: () => Promise<ProjectRecord[]>;
  now?: () => number;
  maxAgeMs?: number;
}

const empty = (): Snapshot => ({projects: [], loaded: false, refreshing: false, error: '', stale: true});
const newestFirst = (items: ProjectRecord[]) => items.sort((a, b) =>
  (Date.parse(b.updated_at || '') || 0) - (Date.parse(a.updated_at || '') || 0) || b.id - a.id);

/** One collection per login, kept alive across route unmounts. No private data is persisted. */
export function createProjectCollection({session, fetchProjects, now = Date.now, maxAgeMs = 5 * 60_000}: Options) {
  let owner = session();
  let snapshot = empty();
  let loadedAt = 0;
  let revision = 0;
  const projectRevisions = new Map<number, number>();
  let pending: {promise: Promise<void>; changes: Map<number, ProjectRecord | null>} | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  const publish = (next: Snapshot) => {snapshot = next; emit();};
  const alignSession = () => {
    const next = session();
    if (next === owner) return false;
    owner = next;
    snapshot = empty();
    loadedAt = 0;
    revision++;
    projectRevisions.clear();
    pending = null;
    return true;
  };
  const current = (expected: string) => {alignSession(); return !!expected && owner === expected;};
  const syncSession = () => {if (alignSession()) emit();};
  const getSnapshot = () => {alignSession(); return snapshot;};
  const subscribe = (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};};

  const load = (force = false): Promise<void> => {
    syncSession();
    if (!owner) return Promise.resolve();
    if (pending) return pending.promise;
    if (!force && !snapshot.stale && (snapshot.error || (snapshot.loaded && now() - loadedAt < maxAgeMs))) return Promise.resolve();
    const expected = owner;
    const startedRevision = revision;
    const request = {promise: Promise.resolve(), changes: new Map<number, ProjectRecord | null>()};
    pending = request;
    // Defer the fetch until the promise is assigned so simultaneous subscribers share it.
    request.promise = Promise.resolve().then(() => current(expected) && pending === request ? fetchProjects() : []).then(items => {
      if (!current(expected) || pending !== request) return;
      const merged = new Map(items.map(item => [item.id, item]));
      // A list response that started before a rename/create/delete cannot undo it.
      request.changes.forEach((item, id) => {
        if (item) merged.set(id, {...merged.get(id), ...item});
        else merged.delete(id);
      });
      loadedAt = now();
      snapshot = {...snapshot, projects: newestFirst([...merged.values()]), loaded: true, error: '', stale: revision !== startedRevision};
    }).catch(cause => {
      if (!current(expected) || pending !== request) return;
      snapshot = {...snapshot, error: errorMessage(cause, '项目列表加载失败'), stale: revision !== startedRevision};
    }).finally(() => {
      if (!current(expected) || pending !== request) return;
      pending = null;
      publish({...snapshot, refreshing: false});
    });
    publish({...snapshot, refreshing: true, error: ''});
    return request.promise;
  };

  const beginRead = (id: number, expected: string) => {
    if (!current(expected)) return -1;
    const next = (projectRevisions.get(id) || 0) + 1;
    projectRevisions.set(id, next);
    return next;
  };
  const canWrite = (id: number, expected: string, readRevision?: number) =>
    current(expected) && (readRevision === undefined || projectRevisions.get(id) === readRevision);
  const upsert = (project: ProjectRecord, expected: string, readRevision?: number) => {
    if (!canWrite(project.id, expected, readRevision)) return;
    beginRead(project.id, expected);
    // Mutation endpoints may omit role; retain the permission from the list.
    const existing = snapshot.projects.find(item => item.id === project.id);
    const merged = {...existing, ...project};
    pending?.changes.set(project.id, merged);
    publish({...snapshot, projects: newestFirst([...snapshot.projects.filter(item => item.id !== project.id), merged])});
  };
  const remove = (id: number, expected: string, readRevision?: number) => {
    if (!canWrite(id, expected, readRevision)) return;
    beginRead(id, expected);
    pending?.changes.set(id, null);
    publish({...snapshot, projects: snapshot.projects.filter(item => item.id !== id)});
  };
  const invalidate = (expected: string) => {
    if (!current(expected)) return;
    revision++;
    publish({...snapshot, stale: true});
  };
  return {getSnapshot, subscribe, load, syncSession, beginRead, upsert, remove, invalidate};
}

/** Internal identity only: never store the token in query keys, DOM, or disk caches. */
export const projectSession = () => {
  const token = readToken();
  const account = cachedUser()?.id;
  return token && account ? `${account}:${token}` : '';
};

export const projectCollection = createProjectCollection({
  session: projectSession,
  fetchProjects: async () => (await invoke<{items: ProjectRecord[]}>({url: '/api/v1/af/projects'})).items ?? [],
});
onAuthChange(projectCollection.syncSession);

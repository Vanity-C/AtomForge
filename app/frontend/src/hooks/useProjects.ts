import {useCallback, useEffect, useSyncExternalStore} from 'react';
import {cachedUser, readToken, type AfUser, type AuthState} from '@/lib/sdk';
import {projectCollection, projectSession} from '@/lib/projectCollection';
import type {ProjectRecord} from '@/lib/projectStore';

const NO_PROJECTS: ProjectRecord[] = [];

/** Dashboard and every sidebar read the same session-scoped snapshot. */
export function useProjects(authState: AuthState, user?: AfUser | null) {
  const snapshot = useSyncExternalStore(projectCollection.subscribe, projectCollection.getSnapshot);
  const session = projectSession();
  const canRead = authState !== 'anonymous' && !!readToken() && !!user && user.id === cachedUser()?.id;
  const enabled = canRead && authState === 'authenticated';
  useEffect(() => {
    if (enabled) void projectCollection.load();
  }, [enabled, session]);
  useEffect(() => {
    if (enabled && snapshot.stale && !snapshot.refreshing) void projectCollection.load();
  }, [enabled, session, snapshot.stale, snapshot.refreshing]);
  const refresh = useCallback(() => {
    if (enabled && session === projectSession()) return projectCollection.load(true);
    return Promise.resolve();
  }, [enabled, session]);
  return {
    projects: canRead ? snapshot.projects : NO_PROJECTS,
    loading: canRead && !snapshot.loaded && !snapshot.error,
    refreshing: canRead && snapshot.refreshing,
    error: canRead ? snapshot.error : '',
    refresh,
  };
}

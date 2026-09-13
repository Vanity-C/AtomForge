import type {ProjectThumbnail} from './projectStore';

interface Options {
  session: () => string;
  fetch: (id: number, cachedOnly: boolean) => Promise<ProjectThumbnail>;
  now?: () => number;
  maxAgeMs?: number;
  maxBytes?: number;
  maxEntries?: number;
}

function pool(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const pump = () => {while (active < limit && queue.length) queue.shift()!();};
  return <T>(run: () => Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    queue.push(() => {
      active++;
      Promise.resolve().then(run).then(resolve, reject).finally(() => {active--; pump();});
    });
    pump();
  });
}

/** Fast reads and expensive first captures have separate queues. Private covers
 * live only in bounded memory for the current login, keyed by project/version. */
export function createProjectThumbnailLoader({session, fetch, now = Date.now, maxAgeMs = 5 * 60_000, maxBytes = 12_000_000, maxEntries = 60}: Options) {
  const read = pool(6), render = pool(1);
  let owner = session(), epoch = 0, bytes = 0;
  const cache = new Map<string, {value: ProjectThumbnail; at: number; size: number}>();
  const pending = new Map<string, {promise: Promise<ProjectThumbnail>; interested: Set<() => boolean>}>();
  const syncSession = () => {
    if (owner === session()) return;
    owner = session(); epoch++; bytes = 0; cache.clear(); pending.clear();
  };
  const keyOf = (id: number, version: number) => `${id}:${version}`;
  const remove = (key: string) => {const entry = cache.get(key); if (entry) bytes -= entry.size; cache.delete(key);};
  const peek = (id: number, version: number): ProjectThumbnail | null => {
    syncSession();
    const key = keyOf(id, version), entry = cache.get(key);
    if (!entry) return null;
    if (now() - entry.at >= maxAgeMs) {remove(key); return null;}
    cache.delete(key); cache.set(key, entry);
    return entry.value;
  };
  const load = (id: number, version: number, interested: () => boolean = () => true): Promise<ProjectThumbnail> => {
    syncSession();
    const hit = peek(id, version);
    if (hit) return Promise.resolve(hit);
    const key = keyOf(id, version);
    const existing = pending.get(key);
    if (existing) {existing.interested.add(interested); return existing.promise;}
    const started = epoch;
    const request = {promise: Promise.resolve({status: 'pending', version} as ProjectThumbnail), interested: new Set([interested])};
    const sameSession = () => {
      syncSession();
      return !!owner && epoch === started;
    };
    const fetchIfCurrent = (cachedOnly: boolean) => {
      if (!sameSession() || ![...request.interested].some(check => check())) throw new Error('预览请求已取消');
      return fetch(id, cachedOnly);
    };
    request.promise = read(() => fetchIfCurrent(true)).then(result => {
      if (result.status === 'pending' && result.version === version) return render(() => fetchIfCurrent(false));
      return result;
    }).then(result => {
      // Completed reads remain useful after route unmount, within this login.
      if (!sameSession()) throw new Error('预览请求已取消');
      if (result.status === 'ready' && result.src && result.version === version) {
        // Avoid retaining old versions of the same project.
        for (const cachedKey of cache.keys()) if (cachedKey.startsWith(`${id}:`)) remove(cachedKey);
        const size = result.src.length * 2;
        if (size <= maxBytes) {
          cache.set(key, {value: result, at: now(), size}); bytes += size;
          while (cache.size > maxEntries || bytes > maxBytes) remove(cache.keys().next().value!);
        }
      }
      return result;
    }).finally(() => {if (pending.get(key) === request) pending.delete(key);});
    pending.set(key, request);
    return request.promise;
  };
  return {peek, load, syncSession};
}

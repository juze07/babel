/**
 * Local persistence (IndexedDB): snapshots (full simulation states) and experiment results.
 * Everything stays in the browser; nothing is sent anywhere.
 */
const DB_NAME = 'babel';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('snapshotData')) db.createObjectStore('snapshotData', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('experiments')) db.createObjectStore('experiments', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface SnapshotMeta {
  id: string;
  label: string;
  created: number;
  tick: number;
  year: number;
  world: string;
  seed: number;
  population: number;
  languages: number;
  parent?: string;
}

export const db = {
  async saveSnapshot(meta: SnapshotMeta, data: unknown) {
    await tx('snapshotData', 'readwrite', (s) => s.put({ id: meta.id, data }));
    await tx('snapshots', 'readwrite', (s) => s.put(meta));
  },
  listSnapshots: () => tx<SnapshotMeta[]>('snapshots', 'readonly', (s) => s.getAll() as IDBRequest<SnapshotMeta[]>),
  async loadSnapshot(id: string) {
    const r = await tx<{ id: string; data: unknown } | undefined>('snapshotData', 'readonly', (s) => s.get(id) as IDBRequest<{ id: string; data: unknown } | undefined>);
    return r?.data;
  },
  async deleteSnapshot(id: string) {
    await tx('snapshots', 'readwrite', (s) => s.delete(id));
    await tx('snapshotData', 'readwrite', (s) => s.delete(id));
  },
  saveExperiment: (exp: { id: string } & Record<string, unknown>) => tx('experiments', 'readwrite', (s) => s.put(exp)),
  listExperiments: () => tx<({ id: string } & Record<string, unknown>)[]>('experiments', 'readonly', (s) => s.getAll() as IDBRequest<({ id: string } & Record<string, unknown>)[]>),
  deleteExperiment: (id: string) => tx('experiments', 'readwrite', (s) => s.delete(id)),
};

export function download(name: string, content: string, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

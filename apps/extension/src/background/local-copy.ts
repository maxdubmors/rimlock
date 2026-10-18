// The Local copy of every Database: its encrypted `.kdbx` bytes in IndexedDB, keyed by Database id
// (sources.md § Local copy). Never decrypted data: the bytes are the file as the Core verified it.

const databaseName = 'rimlock';
const store = 'local-copies';

function openStorage(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(store);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error(`cannot open IndexedDB ${databaseName}`));
    };
  });
}

/** Runs one request in its own transaction and settles once the transaction has committed. */
async function inTransaction<T>(
  mode: IDBTransactionMode,
  run: (objects: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const storage = await openStorage();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = storage.transaction(store, mode);
      const request = run(transaction.objectStore(store));
      transaction.oncomplete = () => {
        resolve(request.result);
      };
      transaction.onerror = transaction.onabort = () => {
        reject(transaction.error ?? new Error(`IndexedDB ${mode} on ${store} failed`));
      };
    });
  } finally {
    storage.close();
  }
}

export async function storeLocalCopy(database: string, bytes: Uint8Array): Promise<void> {
  await inTransaction('readwrite', (objects) => objects.put(bytes, database));
}

/** The Local copy of `database`, or `undefined` if there is none. */
export async function readLocalCopy(database: string): Promise<Uint8Array | undefined> {
  const stored: unknown = await inTransaction('readonly', (objects) => objects.get(database));
  return stored instanceof Uint8Array ? stored : undefined;
}

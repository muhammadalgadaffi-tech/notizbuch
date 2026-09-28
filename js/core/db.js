// Speicher auf dem Gerät (IndexedDB). Hier landen nur verschlüsselte Daten –
// mit Ausnahme der Tresordaten (Salz, Zufallswert, verpackter Schlüssel), die zum Öffnen nötig sind.

const NAME = 'notizbuch';
const VERSION = 1;
export const STORES = ['meta', 'entries', 'kv'];

let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        db.onclose = () => { dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
      req.onblocked = () => { dbPromise = null; reject(new Error('Speicher ist blockiert. Bitte die App neu öffnen.')); };
    });
  }
  return dbPromise;
}

function run(storeName, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    Promise.resolve(fn(store, (r) => { result = r; })).catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Speichern abgebrochen'));
  }));
}

// Safari schließt die Verbindung manchmal, wenn die App im Hintergrund war.
// Dann einmal neu verbinden und wiederholen.
async function withRetry(op) {
  try {
    return await op();
  } catch (err) {
    if (err && (err.name === 'InvalidStateError' || err.name === 'UnknownError' || /connection|closing/i.test(err.message || ''))) {
      dbPromise = null;
      return op();
    }
    throw err;
  }
}

const request = (req, done) => {
  req.onsuccess = () => done(req.result);
};

export const db = {
  get(store, key) {
    return withRetry(() => run(store, 'readonly', (s, done) => request(s.get(key), done)));
  },
  put(store, key, value) {
    return withRetry(() => run(store, 'readwrite', (s) => { s.put(value, key); }));
  },
  del(store, key) {
    return withRetry(() => run(store, 'readwrite', (s) => { s.delete(key); }));
  },
  /** Alle Einträge eines Speichers als [schlüssel, wert]-Paare. */
  entries(store) {
    return withRetry(() => run(store, 'readonly', (s, done) => {
      const out = [];
      const req = s.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else done(out);
      };
    }));
  },
  /** Mehrere Schreibvorgänge in einem Rutsch. ops: [{store, key, value}] oder {store, key, del:true} */
  async batch(ops) {
    const byStore = new Map();
    for (const op of ops) {
      if (!byStore.has(op.store)) byStore.set(op.store, []);
      byStore.get(op.store).push(op);
    }
    const database = await openDB();
    const names = [...byStore.keys()];
    if (!names.length) return;
    await new Promise((resolve, reject) => {
      const tx = database.transaction(names, 'readwrite');
      for (const [name, list] of byStore) {
        const s = tx.objectStore(name);
        for (const op of list) op.del ? s.delete(op.key) : s.put(op.value, op.key);
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Speichern abgebrochen'));
    });
  },
  /** Die komplette Datenbank löschen. */
  async destroy() {
    if (dbPromise) {
      try { (await dbPromise).close(); } catch { /* egal */ }
    }
    dbPromise = null;
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(NAME);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
      req.onblocked = resolve;
    });
  },
};

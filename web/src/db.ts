/**
 * IndexedDB wrapper for offline-first audio recording queue.
 * Stores audio blobs and upload queue for resilience against network issues.
 */

import { UploadQueueItem, AudioBlobRecord } from './types';

const DB_NAME = 's2i_recorder_db';
const DB_VERSION = 1;
const AUDIO_STORE = 'audio_blobs';
const QUEUE_STORE = 'upload_queue';

let db: IDBDatabase | null = null;

/**
 * Initialize IndexedDB connection
 */
export async function initDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Audio blobs store
      if (!database.objectStoreNames.contains(AUDIO_STORE)) {
        const audioStore = database.createObjectStore(AUDIO_STORE, { keyPath: 'clipId' });
        audioStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Upload queue store
      if (!database.objectStoreNames.contains(QUEUE_STORE)) {
        const queueStore = database.createObjectStore(QUEUE_STORE, { keyPath: 'clipId' });
        queueStore.createIndex('timestamp', 'timestamp', { unique: false });
        queueStore.createIndex('retryCount', 'retryCount', { unique: false });
      }
    };
  });
}

/**
 * Save audio blob to IndexedDB
 */
export async function saveAudioBlob(clipId: string, blob: Blob): Promise<void> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([AUDIO_STORE], 'readwrite');
    const store = transaction.objectStore(AUDIO_STORE);

    const record: AudioBlobRecord = {
      clipId,
      blob,
      timestamp: Date.now()
    };

    const request = store.put(record);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get audio blob from IndexedDB
 */
export async function getAudioBlob(clipId: string): Promise<Blob | null> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([AUDIO_STORE], 'readonly');
    const store = transaction.objectStore(AUDIO_STORE);
    const request = store.get(clipId);

    request.onsuccess = () => {
      const record = request.result as AudioBlobRecord | undefined;
      resolve(record ? record.blob : null);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete audio blob from IndexedDB
 */
export async function deleteAudioBlob(clipId: string): Promise<void> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([AUDIO_STORE], 'readwrite');
    const store = transaction.objectStore(AUDIO_STORE);
    const request = store.delete(clipId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Add item to upload queue
 */
export async function enqueueUpload(item: Omit<UploadQueueItem, 'timestamp' | 'retryCount'>): Promise<void> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([QUEUE_STORE], 'readwrite');
    const store = transaction.objectStore(QUEUE_STORE);

    const queueItem: UploadQueueItem = {
      ...item,
      timestamp: Date.now(),
      retryCount: 0
    };

    const request = store.put(queueItem);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all items in upload queue
 */
export async function getUploadQueue(): Promise<UploadQueueItem[]> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([QUEUE_STORE], 'readonly');
    const store = transaction.objectStore(QUEUE_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result as UploadQueueItem[]);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Remove item from upload queue
 */
export async function dequeueUpload(clipId: string): Promise<void> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([QUEUE_STORE], 'readwrite');
    const store = transaction.objectStore(QUEUE_STORE);
    const request = store.delete(clipId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update retry count for a queue item
 */
export async function incrementRetryCount(clipId: string): Promise<void> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([QUEUE_STORE], 'readwrite');
    const store = transaction.objectStore(QUEUE_STORE);
    const getRequest = store.get(clipId);

    getRequest.onsuccess = () => {
      const item = getRequest.result as UploadQueueItem | undefined;
      if (item) {
        item.retryCount += 1;
        const putRequest = store.put(item);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        resolve(); // Item not found, nothing to update
      }
    };

    getRequest.onerror = () => reject(getRequest.error);
  });
}

/**
 * Clear all data from IndexedDB (for testing/debugging)
 */
export async function clearAllData(): Promise<void> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([AUDIO_STORE, QUEUE_STORE], 'readwrite');

    transaction.objectStore(AUDIO_STORE).clear();
    transaction.objectStore(QUEUE_STORE).clear();

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

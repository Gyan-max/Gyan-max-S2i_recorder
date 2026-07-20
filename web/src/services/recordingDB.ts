import { openDB, DBSchema, IDBPDatabase } from 'idb';

// Database configuration
const DB_NAME = 'hinglish-s2i-recordings';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

// Local recording status
export type RecordingStatus = 'LOCAL_ONLY';

// Local recording data model
export interface LocalRecording {
  recordingId: string;
  taskId: string;
  speakerId: string;
  deviceId: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  createdAt: string;
  status: RecordingStatus;
}

// IndexedDB schema
interface RecordingDB extends DBSchema {
  [STORE_NAME]: {
    key: string;
    value: LocalRecording;
    indexes: {
      'by-task': string;
      'by-speaker': string;
      'by-device': string;
      'by-status': RecordingStatus;
      'by-created': string;
    };
  };
}

// Singleton database instance
let dbInstance: IDBPDatabase<RecordingDB> | null = null;

/**
 * Initialize and open the IndexedDB database
 */
export async function openRecordingDB(): Promise<IDBPDatabase<RecordingDB>> {
  if (dbInstance) {
    return dbInstance;
  }

  try {
    dbInstance = await openDB<RecordingDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Create recordings object store
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'recordingId',
        });

        // Create indexes for efficient queries
        store.createIndex('by-task', 'taskId', { unique: false });
        store.createIndex('by-speaker', 'speakerId', { unique: false });
        store.createIndex('by-device', 'deviceId', { unique: false });
        store.createIndex('by-status', 'status', { unique: false });
        store.createIndex('by-created', 'createdAt', { unique: false });
      },
    });

    return dbInstance;
  } catch (error) {
    console.error('Failed to open IndexedDB:', error);
    throw new Error('Unable to initialize local storage. Please check your browser settings.');
  }
}

/**
 * Save a recording to IndexedDB
 */
export async function saveRecording(recording: LocalRecording): Promise<void> {
  try {
    const db = await openRecordingDB();
    await db.put(STORE_NAME, recording);
  } catch (error: any) {
    console.error('Failed to save recording:', error);
    
    if (error.name === 'QuotaExceededError') {
      throw new Error('Storage quota exceeded. Please free up space or upload existing recordings.');
    }
    
    throw new Error('Unable to save your recording on this device. Please try again.');
  }
}

/**
 * Get a specific recording by ID
 */
export async function getRecording(recordingId: string): Promise<LocalRecording | undefined> {
  try {
    const db = await openRecordingDB();
    return await db.get(STORE_NAME, recordingId);
  } catch (error) {
    console.error('Failed to get recording:', error);
    throw new Error('Unable to retrieve recording from local storage.');
  }
}

/**
 * Get all recordings
 */
export async function getAllRecordings(): Promise<LocalRecording[]> {
  try {
    const db = await openRecordingDB();
    return await db.getAll(STORE_NAME);
  } catch (error) {
    console.error('Failed to get all recordings:', error);
    return [];
  }
}

/**
 * Get recordings for a specific task
 */
export async function getRecordingsByTask(taskId: string): Promise<LocalRecording[]> {
  try {
    const db = await openRecordingDB();
    return await db.getAllFromIndex(STORE_NAME, 'by-task', taskId);
  } catch (error) {
    console.error('Failed to get recordings by task:', error);
    return [];
  }
}

/**
 * Get recordings for a specific speaker
 */
export async function getRecordingsBySpeaker(speakerId: string): Promise<LocalRecording[]> {
  try {
    const db = await openRecordingDB();
    return await db.getAllFromIndex(STORE_NAME, 'by-speaker', speakerId);
  } catch (error) {
    console.error('Failed to get recordings by speaker:', error);
    return [];
  }
}

/**
 * Get recordings for a specific device
 */
export async function getRecordingsByDevice(deviceId: string): Promise<LocalRecording[]> {
  try {
    const db = await openRecordingDB();
    return await db.getAllFromIndex(STORE_NAME, 'by-device', deviceId);
  } catch (error) {
    console.error('Failed to get recordings by device:', error);
    return [];
  }
}

/**
 * Delete a specific recording
 */
export async function deleteRecording(recordingId: string): Promise<void> {
  try {
    const db = await openRecordingDB();
    await db.delete(STORE_NAME, recordingId);
  } catch (error) {
    console.error('Failed to delete recording:', error);
    throw new Error('Unable to delete recording from local storage.');
  }
}

/**
 * Update recording metadata (not the blob itself)
 */
export async function updateRecording(
  recordingId: string,
  updates: Partial<Omit<LocalRecording, 'recordingId' | 'blob'>>
): Promise<void> {
  try {
    const db = await openRecordingDB();
    const existing = await db.get(STORE_NAME, recordingId);
    
    if (!existing) {
      throw new Error('Recording not found');
    }

    const updated: LocalRecording = {
      ...existing,
      ...updates,
    };

    await db.put(STORE_NAME, updated);
  } catch (error) {
    console.error('Failed to update recording:', error);
    throw new Error('Unable to update recording in local storage.');
  }
}

/**
 * Count total recordings
 */
export async function countRecordings(): Promise<number> {
  try {
    const db = await openRecordingDB();
    return await db.count(STORE_NAME);
  } catch (error) {
    console.error('Failed to count recordings:', error);
    return 0;
  }
}

/**
 * Count recordings for a specific speaker
 */
export async function countRecordingsBySpeaker(speakerId: string): Promise<number> {
  try {
    const db = await openRecordingDB();
    return await db.countFromIndex(STORE_NAME, 'by-speaker', speakerId);
  } catch (error) {
    console.error('Failed to count recordings by speaker:', error);
    return 0;
  }
}

/**
 * Clear all recordings (use with caution!)
 */
export async function clearAllRecordings(): Promise<void> {
  try {
    const db = await openRecordingDB();
    await db.clear(STORE_NAME);
  } catch (error) {
    console.error('Failed to clear recordings:', error);
    throw new Error('Unable to clear recordings from local storage.');
  }
}

/**
 * Close the database connection
 */
export function closeRecordingDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

import {
  deleteAudioBlob,
  dequeueUpload,
  getUploadQueue,
  incrementRetryCount,
  updateUploadQueueItem,
} from '../db';
import { UploadQueueItem } from '../types';

export interface QueueSyncResult {
  confirmedLocalIds: string[];
  failedLocalIds: string[];
}

async function requestJson(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init);
}

async function syncItem(apiBase: string, item: UploadQueueItem): Promise<boolean> {
  if (!item.taskId) {
    return false;
  }

  let serverClipId = item.serverClipId ?? item.clipId;
  if (item.needsInit && !item.serverClipId) {
    const initResponse = await requestJson(`${apiBase}/clips/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${item.token}`,
        'X-Device-ID': item.deviceId,
      },
      body: JSON.stringify({ task_id: item.taskId, mime_type: item.mimeType }),
    });

    if (initResponse.status === 409) {
      // The task was already confirmed by an earlier successful retry.
      await dequeueUpload(item.clipId);
      await deleteAudioBlob(item.clipId);
      return true;
    }
    if (!initResponse.ok) {
      throw new Error(`Could not reserve recording slot (${initResponse.status})`);
    }

    const initData = await initResponse.json() as { clip_id: string };
    serverClipId = initData.clip_id;
    await updateUploadQueueItem(item.clipId, { serverClipId, lastError: undefined });
  }

  const formData = new FormData();
  formData.append('file', item.blob, 'audio_record');
  const uploadResponse = await requestJson(`${apiBase}/clips/upload?clip_id=${serverClipId}`, {
    method: 'POST',
    headers: { 'X-Device-ID': item.deviceId },
    body: formData,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Could not upload recording (${uploadResponse.status})`);
  }

  const confirmResponse = await requestJson(`${apiBase}/clips/${serverClipId}/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${item.token}`,
    },
    body: JSON.stringify({
      transcript_edit: item.transcriptEdit || undefined,
      prompted: item.prompted ?? false,
    }),
  });
  if (!confirmResponse.ok) {
    throw new Error(`Could not confirm recording (${confirmResponse.status})`);
  }

  await dequeueUpload(item.clipId);
  await deleteAudioBlob(item.clipId);
  return true;
}

/**
 * Replays each confirmed local recording through init -> upload -> confirm.
 * Local audio is removed only after the server confirms the task transaction.
 */
export async function syncUploadQueue(
  apiBase: string,
  onlyClipId?: string,
): Promise<QueueSyncResult> {
  const queue = await getUploadQueue();
  const confirmedLocalIds: string[] = [];
  const failedLocalIds: string[] = [];

  for (const item of queue) {
    if (onlyClipId && item.clipId !== onlyClipId) continue;
    try {
      if (await syncItem(apiBase, item)) {
        confirmedLocalIds.push(item.clipId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      await incrementRetryCount(item.clipId);
      await updateUploadQueueItem(item.clipId, { lastError: message });
      failedLocalIds.push(item.clipId);
    }
  }

  return { confirmedLocalIds, failedLocalIds };
}

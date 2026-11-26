import type { PulseState, RuntimeConfig } from '../server/types.js';
import { PulseStore } from '../server/store.js';
import { fallbackTriage } from '../server/ai.js';

const offlineStore = new PulseStore();
const offlineConfig: RuntimeConfig = {
  telegramBotToken: '',
  telegramDefaultChatId: '',
  aiProvider: 'demo',
  aiApiKey: '',
  aiModel: '',
};

function getOfflineState(): PulseState {
  return offlineStore.getState(offlineConfig, {
    connected: false,
    botUsername: null,
    lastPollAt: null,
  });
}

let offlineModeActive = false;

export function isOfflineMode(): boolean {
  return offlineModeActive;
}

export function getApiBase(): string {
  const envBase = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE;
  if (envBase) return envBase.replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    try {
      const paramBase = new URLSearchParams(window.location.search).get('api');
      if (paramBase) {
        const clean = paramBase.trim().replace(/\/+$/, '');
        window.localStorage.setItem('evenpulse_api_base', clean);
        return clean;
      }
      const saved = window.localStorage.getItem('evenpulse_api_base');
      if (saved) return saved.replace(/\/+$/, '');
    } catch {
      // Ignore storage restrictions inside embedded webviews
    }
  }
  return '';
}

export function setApiBase(url: string): string {
  const clean = url.trim().replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    try {
      if (clean) {
        window.localStorage.setItem('evenpulse_api_base', clean);
      } else {
        window.localStorage.removeItem('evenpulse_api_base');
      }
    } catch {
      // Ignore storage restrictions inside embedded webviews
    }
  }
  offlineModeActive = false;
  return clean;
}

class ApiHttpError extends Error {
  public readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getApiBase()}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new TypeError(`Non-JSON response from ${url} (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new ApiHttpError(`API ${res.status}: ${await res.text()}`, res.status);
  }
  offlineModeActive = false;
  return (await res.json()) as T;
}

function shouldFallbackOffline(err: unknown): boolean {
  return !(err instanceof ApiHttpError && err.status >= 400 && err.status < 500 && err.status !== 404);
}

async function withOfflineFallback<T>(remote: () => Promise<T>, local: () => T): Promise<T> {
  try {
    return await remote();
  } catch (err) {
    if (!shouldFallbackOffline(err)) {
      throw err;
    }
    offlineModeActive = true;
    return local();
  }
}

export const api = {
  getState: async (): Promise<PulseState> => {
    try {
      return await jsonRequest<PulseState>('/api/state');
    } catch {
      return getOfflineState();
    }
  },
  saveConfig: async (cfg: Partial<RuntimeConfig>) => {
    try {
      return await jsonRequest<{ ok: boolean; error?: string; state: PulseState }>('/api/config', {
        method: 'POST',
        body: JSON.stringify(cfg),
      });
    } catch {
      return {
        ok: false,
        error: 'Backend API offline — start `npm run dev` to connect live Telegram/AI keys.',
        state: getOfflineState(),
      };
    }
  },
  simulateMessage: async (payload?: { senderName?: string; chatTitle?: string; text?: string }) => {
    try {
      return await jsonRequest<{ ok: boolean; state: PulseState }>('/api/messages/simulate', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
    } catch {
      const sample = offlineStore.nextSimulatedPayload();
      const senderName = payload?.senderName?.trim() || sample.senderName;
      const chatTitle = payload?.chatTitle?.trim() || sample.chatTitle;
      const text = payload?.text?.trim() || sample.text;
      const triage = fallbackTriage(senderName, text);
      offlineStore.addMessage({
        id: `msg-${Date.now()}`,
        chatId: `demo-${Date.now()}`,
        chatTitle,
        senderName,
        text,
        summary: triage.summary,
        priority: triage.priority,
        timestamp: new Date().toISOString(),
        unread: true,
        source: 'demo',
        drafts: triage.drafts,
      });
      return { ok: true, state: getOfflineState() };
    }
  },
  sendReply: (messageId: string, text: string) =>
    withOfflineFallback(
      () =>
        jsonRequest<{
          ok: boolean;
          deliveredLive: boolean;
          deliveryError?: string;
          state: PulseState;
        }>(`/api/messages/${encodeURIComponent(messageId)}/reply`, {
          method: 'POST',
          body: JSON.stringify({ text }),
        }),
      () => {
        const msg = offlineStore.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.unread = false;
          msg.replied = true;
          msg.replySentText = text;
        }
        return { ok: true, deliveredLive: false, state: getOfflineState() };
      }
    ),
  toggleTask: (taskId: string) =>
    withOfflineFallback(
      () =>
        jsonRequest<{ ok: boolean; state: PulseState }>(
          `/api/tasks/${encodeURIComponent(taskId)}/toggle`,
          { method: 'POST' }
        ),
      () => {
        offlineStore.toggleTask(taskId);
        return { ok: true, state: getOfflineState() };
      }
    ),
  addTask: (title: string) =>
    withOfflineFallback(
      () =>
        jsonRequest<{ ok: boolean; state: PulseState }>('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({ title }),
        }),
      () => {
        offlineStore.addTask({
          id: `task-${Date.now()}`,
          title,
          dueLabel: 'Today',
          priority: 'P1',
          done: false,
          origin: 'voice',
        });
        return { ok: true, state: getOfflineState() };
      }
    ),
  sendVoiceCommand: (transcript: string) =>
    withOfflineFallback(
      () =>
        jsonRequest<{ ok: boolean; state: PulseState }>('/api/voice', {
          method: 'POST',
          body: JSON.stringify({ transcript }),
        }),
      () => {
        offlineStore.addTask({
          id: `task-${Date.now()}`,
          title: transcript.slice(0, 52),
          dueLabel: 'Today',
          priority: 'P1',
          done: false,
          origin: 'voice',
        });
        offlineStore.lastVoiceAction = {
          transcript,
          intent: 'create_task',
          headline: 'Task Added (Offline)',
          detail: transcript.slice(0, 100),
          executedAt: new Date().toISOString(),
        };
        return { ok: true, state: getOfflineState() };
      }
    ),
  sendVoiceAudio: (wavBase64: string) =>
    withOfflineFallback(
      () =>
        jsonRequest<{ ok: boolean; state: PulseState }>('/api/voice/audio', {
          method: 'POST',
          body: JSON.stringify({ wavBase64 }),
        }),
      () => ({ ok: true, state: getOfflineState() })
    ),
  updateMeeting: (payload: { title?: string; timeLabel?: string; brief?: string }) =>
    withOfflineFallback(
      () =>
        jsonRequest<{ ok: boolean; state: PulseState }>('/api/meeting', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      () => {
        if (payload.title) offlineStore.nextMeeting.title = payload.title;
        if (payload.timeLabel) offlineStore.nextMeeting.timeLabel = payload.timeLabel;
        if (payload.brief) offlineStore.nextMeeting.brief = payload.brief;
        return { ok: true, state: getOfflineState() };
      }
    ),
  syncCalendar: async (icsUrl: string) => {
    try {
      return await jsonRequest<{ ok: boolean; error?: string; state: PulseState }>('/api/calendar/sync', {
        method: 'POST',
        body: JSON.stringify({ icsUrl }),
      });
    } catch {
      return {
        ok: false,
        error: 'Start `npm run dev` to fetch live ICS calendar URLs.',
        state: getOfflineState(),
      };
    }
  },
  pushBriefToTelegram: () =>
    withOfflineFallback(
      () =>
        jsonRequest<{
          ok: boolean;
          deliveredLive: boolean;
          deliveryError?: string;
          state: PulseState;
        }>('/api/telegram/push-brief', { method: 'POST' }),
      () => ({ ok: true, deliveredLive: false, state: getOfflineState() })
    ),
  resetDemo: () =>
    withOfflineFallback(
      () => jsonRequest<{ ok: boolean; state: PulseState }>('/api/reset', { method: 'POST' }),
      () => {
        offlineStore.resetDemo();
        return { ok: true, state: getOfflineState() };
      }
    ),
};

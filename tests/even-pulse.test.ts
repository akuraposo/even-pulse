import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateEvenHubPageContainer } from '@evenrealities/even_hub_sdk';
import { buildHudPage, HUD_HEIGHT, HUD_WIDTH, MENU_IDS, type HudView } from '../src/hud/layout.js';
import { EvenG2Controller } from '../src/hud/bridge.js';
import { encodePcm16ToWav } from '../src/hud/audio.js';
import { assertPublicCalendarUrl, parseNextMeetingFromIcs } from '../server/calendar.js';
import { PulseStore } from '../server/store.js';
import { fallbackTriage, parseVoiceCommand, triageMessageWithAi } from '../server/ai.js';
import { TelegramBridge } from '../server/telegram.js';
import { app, config as serverConfig } from '../server/index.js';
import type { RuntimeConfig } from '../server/types.js';

const DEMO_CONFIG: RuntimeConfig = {
  telegramBotToken: '',
  telegramDefaultChatId: '',
  aiProvider: 'demo',
  aiApiKey: '',
  aiModel: '',
};

describe('Even Realities G2 HUD Layout & SDK Validation', () => {
  const store = new PulseStore();
  const state = store.getState(DEMO_CONFIG, {
    connected: false,
    botUsername: null,
    lastPollAt: null,
  });

  const views: HudView[] = ['INBOX', 'MESSAGE', 'BRIEF', 'DIGEST', 'VOICE'];

  it.each(views)('passes official validateEvenHubPageContainer for %s view', (view) => {
    const rendered = buildHudPage(state, {
      view,
      selectedMessageId: state.messages[0].id,
      selectedListIndex: 0,
      isListening: view === 'VOICE',
      toastText: null,
    });

    const validation = validateEvenHubPageContainer(rendered.payload);
    expect(validation).toEqual({ valid: true });

    // Verify all containers stay within 576x288 G2 display bounds
    const allContainers = [
      ...(rendered.payload.textObject || []),
      ...(rendered.payload.listObject || []),
    ];
    expect(rendered.payload.containerTotalNum).toBe(allContainers.length);
    for (const c of allContainers) {
      expect((c.xPosition || 0) + (c.width || 0)).toBeLessThanOrEqual(HUD_WIDTH);
      expect((c.yPosition || 0) + (c.height || 0)).toBeLessThanOrEqual(HUD_HEIGHT);
    }
  });
});

describe('AI Triage & Voice Intent Engine', () => {
  it('classifies urgent deploy message as P0 with 3 drafts', () => {
    const result = fallbackTriage('Alex', 'Urgent: prod deploy needs your approval now');
    expect(result.priority).toBe('P0');
    expect(result.summary.length).toBeLessThanOrEqual(44);
    expect(result.drafts).toHaveLength(3);
  });

  it('parses reply_telegram voice command', async () => {
    const store = new PulseStore();
    const res = await parseVoiceCommand(
      DEMO_CONFIG,
      'Reply to Alex that I am joining in 5 minutes',
      store.messages,
      store.tasks
    );
    expect(res.intent).toBe('reply_telegram');
    expect(res.targetSender?.toLowerCase()).toBe('alex');
    expect(res.replyText).toContain('joining in 5 minutes');
  });

  it('parses create_task voice command', async () => {
    const store = new PulseStore();
    const res = await parseVoiceCommand(
      DEMO_CONFIG,
      'Add task to record G2 demo video',
      store.messages,
      store.tasks
    );
    expect(res.intent).toBe('create_task');
    expect(res.taskTitle).toContain('Record G2 demo video');
  });
});

describe('EvenG2Controller Read & Write Flow', () => {
  it('navigates INBOX -> MESSAGE -> 1-Tap Reply -> INBOX and toggles tasks in BRIEF', async () => {
    const store = new PulseStore();
    const state = store.getState(DEMO_CONFIG, {
      connected: false,
      botUsername: null,
      lastPollAt: null,
    });

    const onSendReply = vi.fn().mockResolvedValue(undefined);
    const onToggleTask = vi.fn().mockResolvedValue(undefined);

    const ctrl = new EvenG2Controller({
      onSendReply,
      onToggleTask,
      onVoiceStart: vi.fn(),
      onVoiceStop: vi.fn(),
      onRender: vi.fn(),
      onTelemetry: vi.fn(),
    });

    await ctrl.syncState(state);
    expect(ctrl.getHudState().view).toBe('INBOX');

    // Tap first message -> opens MESSAGE view
    await ctrl.simulateHardwareInput('CLICK', 'RING');
    expect(ctrl.getHudState().view).toBe('MESSAGE');

    // Tap first AI draft -> sends reply and returns to INBOX
    await ctrl.simulateHardwareInput('CLICK', 'RING');
    expect(onSendReply).toHaveBeenCalledTimes(1);
    expect(ctrl.getHudState().view).toBe('INBOX');

    // Double-tap -> opens BRIEF view
    await ctrl.simulateHardwareInput('DOUBLE_CLICK', 'GLASSES_R');
    expect(ctrl.getHudState().view).toBe('BRIEF');

    // Tap first task -> toggles task completion
    await ctrl.simulateHardwareInput('CLICK', 'RING');
    expect(onToggleTask).toHaveBeenCalledWith('task-1');
  });

  it('encodes 16kHz mono PCM chunks into valid RIFF WAVE header', () => {
    const chunk1 = new Uint8Array([0, 1, 2, 3]);
    const chunk2 = new Uint8Array([4, 5, 6, 7]);
    const wav = encodePcm16ToWav([chunk1, chunk2], 16000);
    expect(wav.byteLength).toBe(44 + 8);
    expect(String.fromCharCode(wav[0], wav[1], wav[2], wav[3])).toBe('RIFF');
    expect(String.fromCharCode(wav[8], wav[9], wav[10], wav[11])).toBe('WAVE');
  });

  it('parses upcoming meeting from ICS calendar feed', () => {
    const sampleIcs = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20261203T150000Z',
      'SUMMARY:Even Realities Demo Day Pitch',
      'DESCRIPTION:Live G2 + Telegram demo with TVM Ventures',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const meeting = parseNextMeetingFromIcs(sampleIcs, new Date('2026-12-03T14:40:00Z'));
    expect(meeting).not.toBeNull();
    expect(meeting?.title).toBe('Even Realities Demo Day Pitch');
    expect(meeting?.timeLabel).toContain('In 20m');
  });

  it('handles native menuItemClickEvent and G2 audio PCM capture', async () => {
    const store = new PulseStore();
    const state = store.getState(DEMO_CONFIG, {
      connected: false,
      botUsername: null,
      lastPollAt: null,
    });
    const onAudio = vi.fn().mockResolvedValue(undefined);
    const ctrl = new EvenG2Controller({
      onSendReply: vi.fn().mockResolvedValue(undefined),
      onToggleTask: vi.fn().mockResolvedValue(undefined),
      onVoiceStart: vi.fn(),
      onVoiceStop: vi.fn(),
      onVoiceAudioCaptured: onAudio,
      onRender: vi.fn(),
      onTelemetry: vi.fn(),
    });
    await ctrl.syncState(state);

    // Invoke menuItemClickEvent handler cleanly via native event dispatcher
    await (ctrl as unknown as { handleNativeEvent: (e: unknown) => Promise<void> }).handleNativeEvent({
      menuItemClickEvent: { itemID: MENU_IDS.DIGEST },
    });
    expect(ctrl.getHudState().view).toBe('DIGEST');

    await ctrl.simulateHardwareInput('LONG_PRESS', 'RING');
    await (ctrl as unknown as { handleNativeEvent: (e: unknown) => Promise<void> }).handleNativeEvent({
      audioEvent: { audioPcm: new Uint8Array([1, 2, 3, 4]) },
    });
    await ctrl.simulateHardwareInput('LONG_PRESS_RELEASE', 'RING');
    expect(onAudio).toHaveBeenCalledTimes(1);
  });

  it('clamps selection bounds on shrink and resets cleanly via resetToHome', async () => {
    const store = new PulseStore();
    const state = store.getState(DEMO_CONFIG, {
      connected: false,
      botUsername: null,
      lastPollAt: null,
    });
    const ctrl = new EvenG2Controller({
      onSendReply: vi.fn().mockResolvedValue(undefined),
      onToggleTask: vi.fn().mockResolvedValue(undefined),
      onVoiceStart: vi.fn(),
      onVoiceStop: vi.fn(),
      onRender: vi.fn(),
      onTelemetry: vi.fn(),
    });
    await ctrl.syncState(state);
    await ctrl.simulateHardwareInput('SCROLL_DOWN', 'RING');
    await ctrl.simulateHardwareInput('SCROLL_DOWN', 'RING');
    expect(ctrl.getHudState().selectedListIndex).toBe(2);

    await ctrl.syncState({ ...state, messages: [state.messages[0]] });
    expect(ctrl.getHudState().selectedListIndex).toBe(0);

    await ctrl.setView('VOICE');
    await ctrl.resetToHome(state, 'Demo reset cleanly');
    expect(ctrl.getHudState().view).toBe('INBOX');
    expect(ctrl.getHudState().toastText).toBe('Demo reset cleanly');
  });

  it('normalizes plain number[] audioPcm arrays from G2 native events', async () => {
    const store = new PulseStore();
    const state = store.getState(DEMO_CONFIG, {
      connected: false,
      botUsername: null,
      lastPollAt: null,
    });
    const onAudio = vi.fn().mockResolvedValue(undefined);
    const ctrl = new EvenG2Controller({
      onSendReply: vi.fn().mockResolvedValue(undefined),
      onToggleTask: vi.fn().mockResolvedValue(undefined),
      onVoiceStart: vi.fn(),
      onVoiceStop: vi.fn(),
      onVoiceAudioCaptured: onAudio,
      onRender: vi.fn(),
      onTelemetry: vi.fn(),
    });
    await ctrl.syncState(state);

    await ctrl.simulateHardwareInput('LONG_PRESS', 'RING');
    await (ctrl as unknown as { handleNativeEvent: (e: unknown) => Promise<void> }).handleNativeEvent({
      audioEvent: { audioPcm: [10, 20, 30, 40] },
    });
    await ctrl.simulateHardwareInput('LONG_PRESS_RELEASE', 'RING');

    expect(onAudio).toHaveBeenCalledTimes(1);
    const wavBytes = Buffer.from(onAudio.mock.calls[0][0] as string, 'base64');
    expect(wavBytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wavBytes.byteLength).toBe(44 + 4);
  });
});

describe('Security, Config & Protocol Edge Cases', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blocks private, local, and non-HTTP URLs in assertPublicCalendarUrl', () => {
    expect(() => assertPublicCalendarUrl('http://127.0.0.1:8080/a.ics')).toThrow();
    expect(() => assertPublicCalendarUrl('http://localhost/cal.ics')).toThrow();
    expect(() => assertPublicCalendarUrl('http://169.254.169.254/latest/meta-data')).toThrow();
    expect(() => assertPublicCalendarUrl('http://192.168.1.50/a.ics')).toThrow();
    expect(() => assertPublicCalendarUrl('file:///etc/passwd')).toThrow();
    expect(assertPublicCalendarUrl('https://calendar.google.com/calendar/ical/example/basic.ics').hostname).toBe(
      'calendar.google.com'
    );
  });

  it('formats zero-minute countdowns as Now instead of In 0m', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20261203T150000Z',
      'SUMMARY:Now Sync',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const meeting = parseNextMeetingFromIcs(ics, new Date('2026-12-03T15:00:00Z'));
    expect(meeting?.timeLabel.startsWith('Now (')).toBe(true);
  });

  it('strips markdown code fences from LLM JSON responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '```json\n{"priority":"P0","summary":"Prod down check","drafts":[{"label":"On it","text":"Checking now"},{"label":"Wait 5m","text":"Give me 5 mins"}]}\n```',
                },
              },
            ],
          }),
          { status: 200 }
        )
      )
    );

    const result = await triageMessageWithAi(
      {
        telegramBotToken: '',
        telegramDefaultChatId: '',
        aiProvider: 'openai',
        aiApiKey: 'sk-test-key',
        aiModel: 'gpt-4o-mini',
      },
      'Alex',
      'Ops',
      'Prod is down'
    );

    expect(result.priority).toBe('P0');
    expect(result.summary).toBe('Prod down check');
    expect(result.drafts).toHaveLength(2);
  });

  it('redacts Telegram bot token from network error messages', async () => {
    const bridge = new TelegramBridge();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('fetch failed: https://api.telegram.org/bot999999:SECRET_TOKEN_ABC/getMe'))
    );

    const res = await bridge.configure({
      ...DEMO_CONFIG,
      telegramBotToken: '999999:SECRET_TOKEN_ABC',
    });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('[REDACTED]');
    expect(res.error).not.toContain('SECRET_TOKEN_ABC');
  });
});

describe('Express API Server Routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves existing server tokens on blank updates and enforces calendar SSRF blocks', async () => {
    const realFetch = globalThis.fetch.bind(globalThis);
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://api.telegram.org/')) {
        if (url.endsWith('/getMe')) {
          return new Response(JSON.stringify({ ok: true, result: { username: 'mockpulse_bot' } }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
      }
      return realFetch(input, init);
    });

    const prevConfig = { ...serverConfig };
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
      s.once('error', reject);
    });
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const healthRes = await realFetch(`${baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);
      expect(await healthRes.json()).toEqual({ ok: true, service: 'even-pulse-api' });

      const ssrfRes = await realFetch(`${baseUrl}/api/calendar/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icsUrl: 'http://127.0.0.1:9000/secret.ics' }),
      });
      const ssrfJson = (await ssrfRes.json()) as { ok: boolean; error?: string };
      expect(ssrfJson.ok).toBe(false);
      expect(ssrfJson.error).toMatch(/Blocked private/i);

      const firstSave = await realFetch(`${baseUrl}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramBotToken: '999:MOCKTOKEN',
          aiProvider: 'gemini',
          aiApiKey: 'AIza-mock-key',
        }),
      });
      const firstData = (await firstSave.json()) as {
        ok: boolean;
        state: { status: { hasTelegramToken?: boolean; hasAiKey?: boolean; telegramBotUsername: string | null } };
      };
      expect(firstData.ok).toBe(true);
      expect(firstData.state.status.hasTelegramToken).toBe(true);
      expect(firstData.state.status.hasAiKey).toBe(true);
      expect(firstData.state.status.telegramBotUsername).toBe('mockpulse_bot');
      expect(JSON.stringify(firstData)).not.toContain('999:MOCKTOKEN');
      expect(JSON.stringify(firstData)).not.toContain('AIza-mock-key');

      const blankSave = await realFetch(`${baseUrl}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramBotToken: '',
          aiApiKey: '',
          telegramDefaultChatId: '424242',
          aiProvider: 'gemini',
        }),
      });
      const blankData = (await blankSave.json()) as {
        ok: boolean;
        state: {
          status: {
            hasTelegramToken?: boolean;
            hasAiKey?: boolean;
            telegramConnected: boolean;
            telegramPairedChatId: string;
          };
        };
      };
      expect(blankData.ok).toBe(true);
      expect(blankData.state.status.hasTelegramToken).toBe(true);
      expect(blankData.state.status.hasAiKey).toBe(true);
      expect(blankData.state.status.telegramConnected).toBe(true);
      expect(blankData.state.status.telegramPairedChatId).toBe('424242');
    } finally {
      await realFetch(`${baseUrl}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearTelegramToken: true, clearAiKey: true }),
      });
      Object.assign(serverConfig, prevConfig);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

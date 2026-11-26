import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import type { AiProvider, RuntimeConfig, TelegramMessage, WorkTask } from './types.js';
import { PulseStore } from './store.js';
import { TelegramBridge } from './telegram.js';
import { generateChannelDigest, parseVoiceCommand, triageMessageWithAi } from './ai.js';
import { fetchNextMeetingFromIcsUrl } from './calendar.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const store = new PulseStore();
const telegram = new TelegramBridge();

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const config: RuntimeConfig = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramDefaultChatId: process.env.TELEGRAM_DEFAULT_CHAT_ID || '',
  aiProvider: (process.env.AI_PROVIDER as AiProvider) || 'openrouter',
  aiApiKey: process.env.AI_API_KEY || '',
  aiModel: process.env.AI_MODEL || '',
};

function persistState(): void {
  if (process.env.VITEST) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(
        {
          messages: store.messages,
          tasks: store.tasks,
          nextMeeting: store.nextMeeting,
          channelDigest: store.channelDigest,
          telegramDefaultChatId: config.telegramDefaultChatId,
        },
        null,
        2
      )
    );
  } catch {
    // Non-fatal in read-only environments
  }
}

function hydrateState(): void {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Partial<{
      messages: TelegramMessage[];
      tasks: WorkTask[];
      nextMeeting: typeof store.nextMeeting;
      channelDigest: string[];
      telegramDefaultChatId: string;
    }>;
    if (Array.isArray(raw.messages) && raw.messages.length > 0) store.messages = raw.messages;
    if (Array.isArray(raw.tasks) && raw.tasks.length > 0) store.tasks = raw.tasks;
    if (
      raw.nextMeeting &&
      typeof raw.nextMeeting.title === 'string' &&
      typeof raw.nextMeeting.timeLabel === 'string'
    ) {
      store.nextMeeting = raw.nextMeeting;
    }
    if (Array.isArray(raw.channelDigest) && raw.channelDigest.length > 0) {
      store.channelDigest = raw.channelDigest;
    }
    if (raw.telegramDefaultChatId && !config.telegramDefaultChatId) {
      config.telegramDefaultChatId = raw.telegramDefaultChatId;
    }
  } catch {
    // Ignore corrupted cache
  }
}

function formatBriefForTelegram(): string {
  const openTasks = store.tasks.filter((t) => !t.done).slice(0, 4);
  return [
    `🕶️ EvenPulse G2 Work Brief`,
    `Next Sync: ${store.nextMeeting.title} (${store.nextMeeting.timeLabel})`,
    `Prep: ${store.nextMeeting.brief}`,
    ``,
    `Open Tasks (${openTasks.length}):`,
    ...openTasks.map((t) => `• [${t.priority}] ${t.title} (${t.dueLabel})`),
  ].join('\n');
}

telegram.setMessageHandler(async (incoming) => {
  // Auto-pair the first Telegram chat that messages the bot!
  if (!config.telegramDefaultChatId && incoming.chatId) {
    config.telegramDefaultChatId = incoming.chatId;
    persistState();
  }

  const trimmed = incoming.text.trim();

  if (trimmed === '/start' || incoming.callbackData === 'cmd_start') {
    await telegram.sendMessage(
      incoming.chatId,
      `🕶️ EvenPulse paired with Even Realities G2!\n\nChat ID ${incoming.chatId} is now linked. Any message you send here will be AI-triaged onto your 576×288 HUD with 1-tap replies.`,
      [
        [
          { text: '📋 Work Brief', callback_data: 'cmd_brief' },
          { text: '⚡ Push P0 Alert to G2', callback_data: 'cmd_push_demo' },
        ],
        [{ text: '✅ Open Tasks', callback_data: 'cmd_tasks' }],
      ]
    );
    return;
  }

  if (trimmed.startsWith('/brief') || incoming.callbackData === 'cmd_brief') {
    await telegram.sendMessage(incoming.chatId, formatBriefForTelegram(), [
      [{ text: '⚡ Push P0 Alert to G2', callback_data: 'cmd_push_demo' }],
    ]);
    return;
  }

  if (incoming.callbackData === 'cmd_tasks') {
    const lines = store.tasks.map((t) => `${t.done ? '☑' : '☐'} [${t.priority}] ${t.title}`);
    await telegram.sendMessage(incoming.chatId, `📋 EvenPulse Tasks:\n${lines.join('\n')}`);
    return;
  }

  if (incoming.callbackData === 'cmd_push_demo') {
    const sample = store.nextSimulatedPayload();
    const triage = await triageMessageWithAi(config, sample.senderName, sample.chatTitle, sample.text);
    store.addMessage({
      id: `tg-demo-${Date.now()}`,
      chatId: incoming.chatId,
      chatTitle: sample.chatTitle,
      senderName: sample.senderName,
      text: sample.text,
      summary: triage.summary,
      priority: 'P0',
      timestamp: new Date().toISOString(),
      unread: true,
      source: 'telegram_live',
      drafts: triage.drafts,
    });
    persistState();
    await telegram.sendMessage(incoming.chatId, `⚡ Pushed P0 alert to your Even G2 HUD: "${triage.summary}"`);
    return;
  }

  if (trimmed === '/task' || trimmed.startsWith('/task ')) {
    const title = trimmed.slice(5).trim();
    if (!title) {
      await telegram.sendMessage(incoming.chatId, 'Usage: /task <action item title>');
      return;
    }
    const task: WorkTask = {
      id: `task-${Date.now()}`,
      title,
      dueLabel: 'Today',
      priority: 'P1',
      done: false,
      origin: 'telegram',
    };
    store.addTask(task);
    persistState();
    await telegram.sendMessage(incoming.chatId, `✅ Added to Even G2 Brief: "${title}"`);
    return;
  }

  const forcedUrgent = trimmed === '/urgent' || trimmed.startsWith('/urgent ');
  const cleanText = forcedUrgent ? trimmed.slice(7).trim() : trimmed;
  if (forcedUrgent && !cleanText) {
    await telegram.sendMessage(incoming.chatId, 'Usage: /urgent <message for P0 HUD alert>');
    return;
  }
  const triage = await triageMessageWithAi(config, incoming.senderName, incoming.chatTitle, cleanText);

  const msg: TelegramMessage = {
    id: `tg-${incoming.updateId}`,
    chatId: incoming.chatId,
    chatTitle: incoming.chatTitle,
    senderName: incoming.senderName,
    senderHandle: incoming.senderHandle,
    text: cleanText,
    summary: triage.summary,
    priority: forcedUrgent ? 'P0' : triage.priority,
    timestamp: incoming.timestamp,
    unread: true,
    source: 'telegram_live',
    drafts: triage.drafts,
  };

  store.addMessage(msg);
  store.channelDigest = await generateChannelDigest(config, store.messages);
  persistState();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'even-pulse-api' });
});

app.get('/api/state', (_req, res) => {
  res.json(store.getState(config, telegram.getStatus()));
});

app.post('/api/config', async (req, res) => {
  const body = req.body as Partial<RuntimeConfig> & {
    clearTelegramToken?: boolean;
    clearAiKey?: boolean;
  };
  if (body.clearTelegramToken) {
    config.telegramBotToken = '';
  } else if (typeof body.telegramBotToken === 'string' && body.telegramBotToken.trim()) {
    config.telegramBotToken = body.telegramBotToken.trim();
  }
  if (typeof body.telegramDefaultChatId === 'string') {
    config.telegramDefaultChatId = body.telegramDefaultChatId.trim();
  }
  if (typeof body.aiProvider === 'string') {
    config.aiProvider = body.aiProvider as AiProvider;
  }
  if (body.clearAiKey) {
    config.aiApiKey = '';
  } else if (typeof body.aiApiKey === 'string' && body.aiApiKey.trim()) {
    config.aiApiKey = body.aiApiKey.trim();
  }
  if (typeof body.aiModel === 'string') {
    config.aiModel = body.aiModel.trim();
  }

  const tgResult = await telegram.configure(config);
  persistState();
  res.json({
    ok: tgResult.ok,
    error: tgResult.error,
    state: store.getState(config, telegram.getStatus()),
  });
});

app.post('/api/messages/simulate', async (req, res) => {
  const custom = req.body as Partial<{ senderName: string; chatTitle: string; text: string }>;
  const sample = store.nextSimulatedPayload();
  const senderName = custom.senderName?.trim() || sample.senderName;
  const chatTitle = custom.chatTitle?.trim() || sample.chatTitle;
  const text = custom.text?.trim() || sample.text;

  const triage = await triageMessageWithAi(config, senderName, chatTitle, text);
  const msg: TelegramMessage = {
    id: `msg-${Date.now()}`,
    chatId: config.telegramDefaultChatId || `demo-${Date.now()}`,
    chatTitle,
    senderName,
    senderHandle: `@${senderName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    text,
    summary: triage.summary,
    priority: triage.priority,
    timestamp: new Date().toISOString(),
    unread: true,
    source: 'demo',
    drafts: triage.drafts,
  };

  store.addMessage(msg);
  store.channelDigest = await generateChannelDigest(config, store.messages);
  persistState();
  res.json({ ok: true, message: msg, state: store.getState(config, telegram.getStatus()) });
});

app.post('/api/messages/:id/reply', async (req, res) => {
  const { id } = req.params;
  const { text } = req.body as { text?: string };
  const msg = store.messages.find((m) => m.id === id);
  if (!msg) {
    res.status(404).json({ ok: false, error: 'Message not found' });
    return;
  }

  const replyText = (text || msg.drafts[0]?.text || 'Got it!').trim();
  const targetChatId = msg.chatId.startsWith('demo-') ? config.telegramDefaultChatId : msg.chatId;
  const delivery = await telegram.sendMessage(targetChatId, replyText);

  msg.unread = false;
  msg.replied = true;
  msg.replySentText = replyText;
  persistState();

  res.json({
    ok: true,
    deliveredLive: delivery.deliveredLive,
    deliveryError: delivery.error,
    state: store.getState(config, telegram.getStatus()),
  });
});

app.post('/api/tasks', (req, res) => {
  const { title, priority, dueLabel } = req.body as Partial<WorkTask>;
  if (!title?.trim()) {
    res.status(400).json({ ok: false, error: 'Task title is required' });
    return;
  }
  const task: WorkTask = {
    id: `task-${Date.now()}`,
    title: title.trim(),
    dueLabel: dueLabel?.trim() || 'Today',
    priority: priority || 'P1',
    done: false,
    origin: 'voice',
  };
  store.addTask(task);
  persistState();
  res.json({ ok: true, task, state: store.getState(config, telegram.getStatus()) });
});

app.post('/api/tasks/:id/toggle', (req, res) => {
  const updated = store.toggleTask(req.params.id);
  if (!updated) {
    res.status(404).json({ ok: false, error: 'Task not found' });
    return;
  }
  persistState();
  res.json({ ok: true, task: updated, state: store.getState(config, telegram.getStatus()) });
});

async function executeVoiceTranscript(transcript: string) {
  const parsed = await parseVoiceCommand(config, transcript, store.messages, store.tasks);

  if (parsed.intent === 'reply_telegram' && parsed.replyText) {
    const targetMsg =
      store.messages.find((m) =>
        parsed.targetSender
          ? m.senderName.toLowerCase().includes(parsed.targetSender.toLowerCase())
          : true
      ) || store.messages[0];

    if (targetMsg) {
      const targetChatId = targetMsg.chatId.startsWith('demo-')
        ? config.telegramDefaultChatId
        : targetMsg.chatId;
      await telegram.sendMessage(targetChatId, parsed.replyText);
      targetMsg.unread = false;
      targetMsg.replied = true;
      targetMsg.replySentText = parsed.replyText;
    }
  } else if (parsed.intent === 'create_task' && parsed.taskTitle) {
    store.addTask({
      id: `task-${Date.now()}`,
      title: parsed.taskTitle,
      dueLabel: 'Today',
      priority: 'P1',
      done: false,
      origin: 'voice',
    });
  }

  store.lastVoiceAction = {
    transcript: transcript.trim(),
    intent: parsed.intent,
    headline: parsed.headline,
    detail: parsed.detail,
    executedAt: new Date().toISOString(),
  };
  persistState();
  return store.lastVoiceAction;
}

app.post('/api/voice', async (req, res) => {
  const { transcript } = req.body as { transcript?: string };
  if (!transcript?.trim()) {
    res.status(400).json({ ok: false, error: 'Transcript is required' });
    return;
  }
  const action = await executeVoiceTranscript(transcript);
  res.json({
    ok: true,
    action,
    state: store.getState(config, telegram.getStatus()),
  });
});

async function transcribeWavAudio(wavBase64: string): Promise<string> {
  if (!config.aiApiKey || config.aiProvider === 'demo') return '';

  try {
    if (config.aiProvider === 'openai') {
      const wavBytes = Buffer.from(wavBase64, 'base64');
      const form = new FormData();
      form.append('file', new Blob([wavBytes], { type: 'audio/wav' }), 'g2-mic.wav');
      form.append('model', 'whisper-1');
      const sttRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.aiApiKey}` },
        body: form,
      });
      if (sttRes.ok) {
        const sttJson = (await sttRes.json()) as { text?: string };
        return (sttJson.text || '').trim();
      }
      return '';
    }

    if (config.aiProvider === 'gemini') {
      const model = config.aiModel || 'gemini-2.0-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.aiApiKey)}`;
      const sttRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: 'Transcribe the spoken English command verbatim as plain text with no extra commentary.',
                },
                { inlineData: { mimeType: 'audio/wav', data: wavBase64 } },
              ],
            },
          ],
          generationConfig: { temperature: 0 },
        }),
      });
      if (sttRes.ok) {
        const sttJson = (await sttRes.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        return (sttJson.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      }
      return '';
    }

    if (config.aiProvider === 'openrouter') {
      const audioModel =
        config.aiModel && /gemini|audio/i.test(config.aiModel)
          ? config.aiModel
          : 'google/gemini-2.0-flash-001';
      const sttRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.aiApiKey}`,
          'HTTP-Referer': 'https://dorahacks.io/hackathon/even-realities',
          'X-Title': 'EvenPulse G2 Assistant',
        },
        body: JSON.stringify({
          model: audioModel,
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Transcribe the spoken command verbatim as plain text with no extra commentary.',
                },
                {
                  type: 'input_audio',
                  input_audio: { data: wavBase64, format: 'wav' },
                },
              ],
            },
          ],
        }),
      });
      if (sttRes.ok) {
        const sttJson = (await sttRes.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        return (sttJson.choices?.[0]?.message?.content || '').trim();
      }
    }
  } catch {
    return '';
  }

  return '';
}

// Accepts 16kHz mono WAV captured directly from Even G2 microphones (`event.audioEvent.audioPcm`)
app.post('/api/voice/audio', async (req, res) => {
  const { wavBase64 } = req.body as { wavBase64?: string };
  if (!wavBase64) {
    res.status(400).json({ ok: false, error: 'wavBase64 is required' });
    return;
  }

  const transcript = await transcribeWavAudio(wavBase64);

  if (!transcript) {
    store.lastVoiceAction = {
      transcript: '[G2 WAV Audio]',
      intent: 'ask_ai',
      headline: 'G2 Mic Audio Captured',
      detail: 'Add OpenAI, Gemini, or OpenRouter key in Setup for live G2 audio STT, or use Companion Speak.',
      executedAt: new Date().toISOString(),
    };
    persistState();
    res.json({
      ok: true,
      action: store.lastVoiceAction,
      state: store.getState(config, telegram.getStatus()),
    });
    return;
  }

  const action = await executeVoiceTranscript(transcript);
  res.json({
    ok: true,
    action,
    state: store.getState(config, telegram.getStatus()),
  });
});

app.post('/api/meeting', (req, res) => {
  const { title, timeLabel, brief } = req.body as Partial<{
    title: string;
    timeLabel: string;
    brief: string;
  }>;
  if (title?.trim()) store.nextMeeting.title = title.trim().slice(0, 48);
  if (timeLabel?.trim()) store.nextMeeting.timeLabel = timeLabel.trim().slice(0, 28);
  if (brief?.trim()) store.nextMeeting.brief = brief.trim().slice(0, 96);
  persistState();
  res.json({ ok: true, meeting: store.nextMeeting, state: store.getState(config, telegram.getStatus()) });
});

app.post('/api/calendar/sync', async (req, res) => {
  const { icsUrl } = req.body as { icsUrl?: string };
  if (!icsUrl?.trim()) {
    res.status(400).json({ ok: false, error: 'icsUrl is required' });
    return;
  }
  try {
    const meeting = await fetchNextMeetingFromIcsUrl(icsUrl.trim());
    if (!meeting) {
      res.json({
        ok: false,
        error: 'No upcoming events found in that ICS calendar.',
        state: store.getState(config, telegram.getStatus()),
      });
      return;
    }
    store.nextMeeting = meeting;
    persistState();
    res.json({ ok: true, meeting, state: store.getState(config, telegram.getStatus()) });
  } catch (err) {
    res.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to fetch ICS calendar',
      state: store.getState(config, telegram.getStatus()),
    });
  }
});

app.post('/api/telegram/push-brief', async (_req, res) => {
  const text = formatBriefForTelegram();
  const delivery = await telegram.sendMessage(config.telegramDefaultChatId, text, [
    [{ text: '⚡ Push P0 Alert to G2', callback_data: 'cmd_push_demo' }],
  ]);
  res.json({
    ok: true,
    deliveredLive: delivery.deliveredLive,
    deliveryError: delivery.error,
    preview: text,
    state: store.getState(config, telegram.getStatus()),
  });
});

app.post('/api/reset', (_req, res) => {
  store.resetDemo();
  persistState();
  res.json({ ok: true, state: store.getState(config, telegram.getStatus()) });
});

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';

async function start() {
  hydrateState();
  if (config.telegramBotToken) {
    const result = await telegram.configure(config);
    console.log(
      result.ok
        ? `[EvenPulse] Telegram Bot connected: @${result.botUsername}`
        : `[EvenPulse] Telegram Bot error: ${result.error}`
    );
  }
  app.listen(PORT, HOST, () => {
    console.log(`[EvenPulse] API server ready at http://${HOST}:${PORT}`);
  });
}

if (!process.env.VITEST) {
  void start();
}

export { app, store, config, start };

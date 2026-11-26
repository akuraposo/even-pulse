import type { AiDraftReply, AiProvider, PriorityLevel, RuntimeConfig, TelegramMessage, WorkTask } from './types.js';

export interface TriageOutput {
  priority: PriorityLevel;
  summary: string;
  drafts: AiDraftReply[];
}

export interface VoiceIntentOutput {
  intent: 'reply_telegram' | 'create_task' | 'brief' | 'ask_ai';
  targetSender?: string;
  replyText?: string;
  taskTitle?: string;
  headline: string;
  detail: string;
}

function clampText(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

function parseJsonSafe<T>(raw?: string): T | null {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

async function callLlmJson<T>(
  config: RuntimeConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<T | null> {
  if (!config.aiApiKey || config.aiProvider === 'demo') {
    return null;
  }

  try {
    if (config.aiProvider === 'gemini') {
      const model = config.aiModel || 'gemini-2.0-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.aiApiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(12_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
          },
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return parseJsonSafe<T>(data.candidates?.[0]?.content?.parts?.[0]?.text);
    }

    const endpoint =
      config.aiProvider === 'openai'
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://openrouter.ai/api/v1/chat/completions';

    const model =
      config.aiModel ||
      (config.aiProvider === 'openai' ? 'gpt-4o-mini' : 'openai/gpt-4o-mini');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.aiApiKey}`,
    };
    if (config.aiProvider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://dorahacks.io/hackathon/even-realities';
      headers['X-Title'] = 'EvenPulse G2 Assistant';
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(12_000),
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return parseJsonSafe<T>(data.choices?.[0]?.message?.content);
  } catch {
    return null;
  }
}

export function fallbackTriage(senderName: string, text: string): TriageOutput {
  const lower = text.toLowerCase();
  let priority: PriorityLevel = 'P2';
  if (
    /urgent|asap|now|prod|down|outage|deadline|investor|deploy|sign|approve|late|5 min|call/i.test(
      lower
    )
  ) {
    priority = 'P0';
  } else if (/review|deck|pr|meeting|schedule|sync|update|feedback|budget|ship/i.test(lower)) {
    priority = 'P1';
  }

  const summary = clampText(text, 44);

  let drafts: AiDraftReply[];
  if (/late|call|meeting|sync|zoom|join/i.test(lower)) {
    drafts = [
      { id: 'd1', label: 'Join in 5m', text: `On my way, ${senderName} — joining in 5 minutes.` },
      { id: 'd2', label: 'Push 15m', text: `Can we push this by 15 mins? Wrapping up a quick item.` },
      { id: 'd3', label: 'Send Notes', text: `Running tight right now — please drop the key points here and I'll review right after.` },
    ];
  } else if (/approve|sign|deploy|release|prod|ship/i.test(lower)) {
    drafts = [
      { id: 'd1', label: 'Approved', text: `Approved — go ahead and ship it.` },
      { id: 'd2', label: 'Hold 10m', text: `Hold for 10 mins, let me do a quick sanity check first.` },
      { id: 'd3', label: 'Need Logs', text: `Can you share the checklist/metrics before we push live?` },
    ];
  } else {
    drafts = [
      { id: 'd1', label: 'Got it', text: `Got it, thanks ${senderName}! I'm on it.` },
      { id: 'd2', label: 'Later Today', text: `Noted — I'll review and circle back before EOD.` },
      { id: 'd3', label: 'Quick Call?', text: `Let's do a quick 5-min sync to finalize this.` },
    ];
  }

  return { priority, summary, drafts };
}

export async function triageMessageWithAi(
  config: RuntimeConfig,
  senderName: string,
  chatTitle: string,
  text: string
): Promise<TriageOutput> {
  const llm = await callLlmJson<{
    priority?: PriorityLevel;
    summary?: string;
    drafts?: Array<{ label?: string; text?: string }>;
  }>(
    config,
    `You are EvenPulse, an AI assistant for Even Realities G2 smart glasses (576x288 micro-LED HUD).
Return strict JSON:
{
  "priority": "P0" | "P1" | "P2",
  "summary": "ultra-concise glanceable summary under 44 chars",
  "drafts": [
    { "label": "2-word button label <= 14 chars", "text": "natural Telegram reply" },
    { "label": "2-word button label <= 14 chars", "text": "natural Telegram reply" },
    { "label": "2-word button label <= 14 chars", "text": "natural Telegram reply" }
  ]
}`,
    `Chat: ${chatTitle}\nSender: ${senderName}\nMessage: ${text}`
  );

  if (llm?.summary && Array.isArray(llm.drafts) && llm.drafts.length >= 2) {
    const priority: PriorityLevel =
      llm.priority === 'P0' || llm.priority === 'P1' || llm.priority === 'P2'
        ? llm.priority
        : 'P1';
    return {
      priority,
      summary: clampText(llm.summary, 44),
      drafts: llm.drafts.slice(0, 3).map((d, idx) => ({
        id: `d${idx + 1}`,
        label: clampText(d.label || `Reply ${idx + 1}`, 16),
        text: (d.text || 'Got it, thanks!').trim(),
      })),
    };
  }

  return fallbackTriage(senderName, text);
}

export async function parseVoiceCommand(
  config: RuntimeConfig,
  transcript: string,
  messages: TelegramMessage[],
  tasks: WorkTask[]
): Promise<VoiceIntentOutput> {
  const clean = transcript.trim();

  const llm = await callLlmJson<VoiceIntentOutput>(
    config,
    `You are EvenPulse voice router on Even Realities G2 smart glasses.
Classify the user's spoken command into one intent:
- "reply_telegram": user wants to reply/message someone on Telegram
- "create_task": user wants to add a work task/todo/reminder
- "brief": user asks for summary/brief/schedule/digest
- "ask_ai": general quick work question

Return strict JSON:
{
  "intent": "reply_telegram" | "create_task" | "brief" | "ask_ai",
  "targetSender": "optional sender name if replying",
  "replyText": "clean ready-to-send Telegram message if replying",
  "taskTitle": "concise task title if creating task",
  "headline": "short HUD confirmation <= 36 chars",
  "detail": "concise HUD detail <= 110 chars"
}`,
    `Recent senders: ${messages.map((m) => m.senderName).join(', ')}\nOpen tasks: ${tasks.filter((t) => !t.done).length}\nSpoken command: "${clean}"`
  );

  if (llm?.intent && llm.headline) {
    return {
      ...llm,
      headline: clampText(llm.headline, 36),
      detail: clampText(llm.detail || clean, 110),
    };
  }

  // Smart deterministic fallback
  const lower = clean.toLowerCase();
  const replyMatch = clean.match(/(?:reply|tell|message|send)\s+(?:to\s+)?([a-zA-Z]+)(?:\s+that|\s*:|\s+)(.+)/i);
  if (replyMatch || lower.startsWith('reply')) {
    const targetSender = replyMatch?.[1] || messages[0]?.senderName || 'Team';
    const replyText = (replyMatch?.[2] || clean.replace(/^reply\s*/i, '')).trim();
    return {
      intent: 'reply_telegram',
      targetSender,
      replyText: replyText.charAt(0).toUpperCase() + replyText.slice(1),
      headline: clampText(`Sent to ${targetSender}`, 36),
      detail: clampText(replyText, 110),
    };
  }

  if (/task|todo|remind|add|note|follow up|review/i.test(lower)) {
    const taskTitle = clean
      .replace(/^(?:add|create|new|remind me to)\s+(?:a\s+)?(?:task|todo|reminder)?\s*(?:to)?\s*/i, '')
      .trim();
    const finalTitle = taskTitle
      ? taskTitle.charAt(0).toUpperCase() + taskTitle.slice(1)
      : clean;
    return {
      intent: 'create_task',
      taskTitle: clampText(finalTitle, 52),
      headline: 'Task Added to Brief',
      detail: clampText(finalTitle, 110),
    };
  }

  if (/brief|summary|digest|schedule|meeting|status/i.test(lower)) {
    const unreadP0 = messages.filter((m) => m.unread && m.priority === 'P0').length;
    const openTasks = tasks.filter((t) => !t.done).length;
    return {
      intent: 'brief',
      headline: 'Heads-Up Work Brief',
      detail: `${unreadP0} urgent TG msgs · ${openTasks} open tasks · Next sync in 12m.`,
    };
  }

  return {
    intent: 'ask_ai',
    headline: 'EvenPulse AI',
    detail: clampText(`Noted: "${clean}". Ready for next command or 1-tap Telegram action.`, 110),
  };
}

export async function generateChannelDigest(
  config: RuntimeConfig,
  messages: TelegramMessage[]
): Promise<string[]> {
  const llm = await callLlmJson<{ bullets?: string[] }>(
    config,
    `Summarize these Telegram work messages into exactly 3 ultra-short glanceable HUD bullets (max 44 chars each). Return JSON: { "bullets": ["...", "...", "..."] }`,
    messages.map((m) => `[${m.priority}] ${m.chatTitle} (${m.senderName}): ${m.text}`).join('\n')
  );

  if (llm?.bullets && llm.bullets.length > 0) {
    return llm.bullets.slice(0, 3).map((b) => clampText(b, 44));
  }

  return messages.slice(0, 3).map((m) => clampText(`${m.senderName}: ${m.summary}`, 44));
}

export function detectProvider(config: RuntimeConfig): AiProvider {
  if (!config.aiApiKey) return 'demo';
  return config.aiProvider || 'openrouter';
}

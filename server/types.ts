export type PriorityLevel = 'P0' | 'P1' | 'P2';
export type AiProvider = 'openrouter' | 'gemini' | 'openai' | 'demo';

export interface AiDraftReply {
  id: string;
  label: string; // Short 1-2 word tag for G2 HUD, e.g., "Approve"
  text: string;  // Full reply text sent to Telegram
}

export interface TelegramMessage {
  id: string;
  chatId: string;
  chatTitle: string;
  senderName: string;
  senderHandle?: string;
  text: string;
  summary: string;       // <= 48 char glanceable summary for G2 HUD
  priority: PriorityLevel;
  timestamp: string;
  unread: boolean;
  replied?: boolean;
  replySentText?: string;
  source: 'telegram_live' | 'demo';
  drafts: AiDraftReply[];
}

export interface WorkTask {
  id: string;
  title: string;
  dueLabel: string;      // e.g., "14:00", "Today", "EOD"
  priority: PriorityLevel;
  done: boolean;
  origin: 'telegram' | 'voice' | 'calendar';
}

export interface MeetingItem {
  id: string;
  title: string;
  timeLabel: string;     // e.g., "In 12m (15:00)"
  attendees: string;
  brief: string;         // 1-line AI meeting prep for G2 HUD
}

export interface VoiceActionResult {
  transcript: string;
  intent: 'reply_telegram' | 'create_task' | 'brief' | 'ask_ai';
  headline: string;      // Glanceable G2 confirmation
  detail: string;
  executedAt: string;
}

export interface ConnectionStatus {
  telegramConnected: boolean;
  telegramBotUsername: string | null;
  telegramPairedChatId: string | null;
  hasTelegramToken?: boolean;
  hasAiKey?: boolean;
  aiProvider: AiProvider;
  aiLive: boolean;
  lastPollAt: string | null;
}

export interface PulseState {
  messages: TelegramMessage[];
  tasks: WorkTask[];
  nextMeeting: MeetingItem;
  channelDigest: string[];
  lastVoiceAction: VoiceActionResult | null;
  status: ConnectionStatus;
}

export interface RuntimeConfig {
  telegramBotToken: string;
  telegramDefaultChatId: string;
  aiProvider: AiProvider;
  aiApiKey: string;
  aiModel: string;
}

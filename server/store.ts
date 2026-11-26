import type {
  MeetingItem,
  PulseState,
  RuntimeConfig,
  TelegramMessage,
  VoiceActionResult,
  WorkTask,
} from './types.js';
import { detectProvider } from './ai.js';

const DEMO_MESSAGES: TelegramMessage[] = [
  {
    id: 'msg-1',
    chatId: 'demo-founders',
    chatTitle: 'Founders & Product',
    senderName: 'Alex Chen',
    senderHandle: '@alexchen',
    text: 'Urgent: TVM Ventures partner wants the G2 demo link 15 mins before our 3 PM pitch. Can we approve v1.2 deploy now?',
    summary: 'Approve v1.2 deploy before 3PM pitch?',
    priority: 'P0',
    timestamp: new Date(Date.now() - 2 * 60_000).toISOString(),
    unread: true,
    source: 'demo',
    drafts: [
      { id: 'd1', label: 'Approve Ship', text: 'Approved — go ahead and push v1.2 live now. I will review the link on my G2.' },
      { id: 'd2', label: 'Hold 10m', text: 'Hold 10 mins — let me verify the Telegram webhook before we deploy.' },
      { id: 'd3', label: 'Send Link', text: 'Drop the staging URL here and I will give the green light right away.' },
    ],
  },
  {
    id: 'msg-2',
    chatId: 'demo-eng',
    chatTitle: 'G2 Core Eng',
    senderName: 'Maya Lin',
    senderHandle: '@mayalin',
    text: 'Heads up: PR #48 cuts BLE text refresh latency by 42%. Ready for your quick sign-off.',
    summary: 'PR #48 cuts BLE latency 42% — sign off?',
    priority: 'P1',
    timestamp: new Date(Date.now() - 14 * 60_000).toISOString(),
    unread: true,
    source: 'demo',
    drafts: [
      { id: 'd1', label: 'LGTM Merge', text: 'Awesome 42% win — LGTM, feel free to merge!' },
      { id: 'd2', label: 'Review 4PM', text: 'Great work Maya! I will review right after the 3 PM sync.' },
      { id: 'd3', label: 'Run Sim', text: 'Looks solid — did it pass evenhub-simulator layout checks?' },
    ],
  },
  {
    id: 'msg-3',
    chatId: 'demo-channel',
    chatTitle: 'Even Realities Devs',
    senderName: 'Daos Hub',
    senderHandle: '@daoshub',
    text: 'Reminder: Heads Up hackathon submissions close Sunday 19:59 UTC. Include a working simulator or G2 hardware demo video.',
    summary: 'Hackathon deadline Sun 19:59 UTC',
    priority: 'P2',
    timestamp: new Date(Date.now() - 41 * 60_000).toISOString(),
    unread: true,
    source: 'demo',
    drafts: [
      { id: 'd1', label: 'On Track', text: 'Thanks for the reminder — our G2 demo video is almost ready!' },
      { id: 'd2', label: 'Share Repo', text: 'Will submit our public GitHub repo and simulator walkthrough tonight.' },
      { id: 'd3', label: 'Noted', text: 'Noted, appreciate the heads-up!' },
    ],
  },
];

const DEMO_TASKS: WorkTask[] = [
  {
    id: 'task-1',
    title: 'Approve v1.2 release for TVM pitch',
    dueLabel: '14:45',
    priority: 'P0',
    done: false,
    origin: 'telegram',
  },
  {
    id: 'task-2',
    title: 'Record 90s G2 simulator demo video',
    dueLabel: '17:00',
    priority: 'P1',
    done: false,
    origin: 'calendar',
  },
  {
    id: 'task-3',
    title: 'Review Maya PR #48 BLE latency fix',
    dueLabel: 'EOD',
    priority: 'P1',
    done: false,
    origin: 'telegram',
  },
];

const DEMO_MEETING: MeetingItem = {
  id: 'meet-1',
  title: 'TVM Ventures Demo Sync',
  timeLabel: 'In 12m (15:00)',
  attendees: 'Alex, Maya, TVM Partner',
  brief: 'Show 1-tap Telegram reply + Voice-to-Task on G2 HUD.',
};

const SIMULATED_POOL: Array<{ chatTitle: string; senderName: string; senderHandle: string; text: string }> = [
  {
    chatTitle: 'Founders & Product',
    senderName: 'Raka Putra',
    senderHandle: '@rakaputra',
    text: 'Urgent: Investor deck slide 7 is ready for final sign-off before we walk in. Approve launch?',
  },
  {
    chatTitle: 'Design Ops',
    senderName: 'Sora Sato',
    senderHandle: '@sorasato',
    text: 'Can you confirm if we keep 3 quick-reply slots on the G2 HUD? Testing readability on 576x288 right now.',
  },
  {
    chatTitle: 'Telegram Bot Alerts',
    senderName: 'DeployBot',
    senderHandle: '@deploybot',
    text: 'Production build #109 passed all 18 tests and is waiting for 1-tap release confirmation.',
  },
];

export class PulseStore {
  public messages: TelegramMessage[] = structuredClone(DEMO_MESSAGES);
  public tasks: WorkTask[] = structuredClone(DEMO_TASKS);
  public nextMeeting: MeetingItem = structuredClone(DEMO_MEETING);
  public channelDigest: string[] = [
    'Alex: Approve v1.2 deploy before 3PM pitch',
    'Maya: PR #48 cuts BLE latency 42%',
    'Daos Hub: Submission closes Sun 19:59 UTC',
  ];
  public lastVoiceAction: VoiceActionResult | null = null;
  private simIndex = 0;

  public resetDemo(): void {
    this.messages = structuredClone(DEMO_MESSAGES);
    this.tasks = structuredClone(DEMO_TASKS);
    this.nextMeeting = structuredClone(DEMO_MEETING);
    this.channelDigest = [
      'Alex: Approve v1.2 deploy before 3PM pitch',
      'Maya: PR #48 cuts BLE latency 42%',
      'Daos Hub: Submission closes Sun 19:59 UTC',
    ];
    this.lastVoiceAction = null;
  }

  public nextSimulatedPayload() {
    const item = SIMULATED_POOL[this.simIndex % SIMULATED_POOL.length];
    this.simIndex += 1;
    return item;
  }

  public addMessage(msg: TelegramMessage): void {
    this.messages = [msg, ...this.messages].slice(0, 20);
    this.messages.sort((a, b) => {
      const rank = { P0: 0, P1: 1, P2: 2 };
      if (a.unread !== b.unread) return a.unread ? -1 : 1;
      if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
      return b.timestamp.localeCompare(a.timestamp);
    });
  }

  public addTask(task: WorkTask): void {
    this.tasks = [task, ...this.tasks].slice(0, 15);
  }

  public toggleTask(id: string): WorkTask | null {
    const found = this.tasks.find((t) => t.id === id);
    if (!found) return null;
    found.done = !found.done;
    return found;
  }

  public getState(
    config: RuntimeConfig,
    telegramStatus: { connected: boolean; botUsername: string | null; lastPollAt: string | null }
  ): PulseState {
    const aiProvider = detectProvider(config);
    return {
      messages: this.messages,
      tasks: this.tasks,
      nextMeeting: this.nextMeeting,
      channelDigest: this.channelDigest,
      lastVoiceAction: this.lastVoiceAction,
      status: {
        telegramConnected: telegramStatus.connected,
        telegramBotUsername: telegramStatus.botUsername,
        telegramPairedChatId: config.telegramDefaultChatId || null,
        hasTelegramToken: Boolean(config.telegramBotToken),
        hasAiKey: Boolean(config.aiApiKey),
        aiProvider,
        aiLive: aiProvider !== 'demo',
        lastPollAt: telegramStatus.lastPollAt,
      },
    };
  }
}

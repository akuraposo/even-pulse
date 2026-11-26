import './styles.css';
import { api, getApiBase, isOfflineMode, setApiBase } from './api.js';
import { EvenG2Controller, type TelemetryEntry } from './hud/bridge.js';
import type { HudState, HudView, RenderedHudPage } from './hud/layout.js';
import type { AiProvider, PulseState } from '../server/types.js';

const el = {
  pillSdk: document.getElementById('pill-sdk')!,
  pillTg: document.getElementById('pill-tg')!,
  pillAi: document.getElementById('pill-ai')!,
  g2Header: document.getElementById('g2-header')!,
  g2Body: document.getElementById('g2-body')!,
  g2List: document.getElementById('g2-list')!,
  g2Footer: document.getElementById('g2-footer')!,
  g2ViewIndicator: document.getElementById('g2-view-indicator')!,
  companionMessages: document.getElementById('companion-messages')!,
  companionTasks: document.getElementById('companion-tasks')!,
  meetingCard: document.getElementById('meeting-card')!,
  hwClock: document.getElementById('hw-clock')!,
  g2MenuOverlay: document.getElementById('g2-menu-overlay')!,
  globalToast: document.getElementById('global-toast')!,
  telemetryLog: document.getElementById('telemetry-log')!,
  voiceInput: document.getElementById('voice-input') as HTMLInputElement,
  voiceBtn: document.getElementById('hw-voice') as HTMLButtonElement,
  cfgForm: document.getElementById('config-form') as HTMLFormElement,
  cfgApiBase: document.getElementById('cfg-api-base') as HTMLInputElement,
  cfgTgToken: document.getElementById('cfg-tg-token') as HTMLInputElement,
  cfgTgChat: document.getElementById('cfg-tg-chat') as HTMLInputElement,
  cfgAiProvider: document.getElementById('cfg-ai-provider') as HTMLSelectElement,
  cfgAiModel: document.getElementById('cfg-ai-model') as HTMLInputElement,
  cfgAiKey: document.getElementById('cfg-ai-key') as HTMLInputElement,
  cfgFeedback: document.getElementById('cfg-feedback')!,
  btnReset: document.getElementById('btn-reset') as HTMLButtonElement,
};

let currentState: PulseState | null = null;
let mutationEpoch = 0;
let latestBatteryLevel: number | null = null;
const telemetry: TelemetryEntry[] = [];

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

let activeRecognition: BrowserSpeechRecognition | null = null;

function pushTelemetry(entry: TelemetryEntry): void {
  telemetry.unshift(entry);
  if (telemetry.length > 60) telemetry.pop();
  el.telemetryLog.innerHTML = telemetry
    .map(
      (t) =>
        `<div class="tele-row tele-${t.direction.toLowerCase()}"><span>[${t.time}]</span><span>${t.direction}</span><span>${escapeHtml(t.message)}</span></div>`
    )
    .join('');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderG2Mirror(page: RenderedHudPage, hud: HudState, sdkConnected: boolean): void {
  el.g2Header.textContent = page.headerText;
  el.g2Footer.textContent = page.footerText;
  el.g2ViewIndicator.textContent = `VIEW: ${hud.view}`;

  if (page.bodyText) {
    el.g2Body.textContent = page.bodyText;
    el.g2Body.classList.remove('hidden');
  } else {
    el.g2Body.classList.add('hidden');
  }

  if (page.listItems.length > 0) {
    el.g2List.classList.remove('hidden');
    el.g2List.innerHTML = page.listItems
      .map(
        (item, idx) =>
          `<li class="${idx === hud.selectedListIndex ? 'selected' : ''}" data-idx="${idx}">${escapeHtml(item)}</li>`
      )
      .join('');
    el.g2List.querySelectorAll('li').forEach((li) => {
      li.addEventListener('click', () => {
        const idx = Number(li.getAttribute('data-idx') || 0);
        const cur = controller.getHudState().selectedListIndex;
        if (idx === cur) {
          void controller.simulateHardwareInput('CLICK', 'GLASSES_R');
        } else {
          const steps = Math.abs(idx - cur);
          const dir = idx > cur ? 'SCROLL_DOWN' : 'SCROLL_UP';
          void (async () => {
            for (let i = 0; i < steps; i++) {
              await controller.simulateHardwareInput(dir, 'GLASSES_R');
            }
          })();
        }
      });
    });
  } else {
    el.g2List.classList.add('hidden');
  }

  document.querySelectorAll('.view-switcher .chip').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === hud.view);
  });

  const batterySuffix = latestBatteryLevel !== null ? ` (${latestBatteryLevel}%)` : '';
  el.pillSdk.textContent = sdkConnected
    ? `SDK: G2 Live${batterySuffix}`
    : `SDK: Mirror Mode${batterySuffix}`;
  el.pillSdk.className = `pill ${sdkConnected ? 'pill-live' : 'pill-muted'}`;
}

function showGlobalToast(message: string): void {
  el.globalToast.textContent = message;
  el.globalToast.classList.remove('hidden');
  setTimeout(() => {
    if (el.globalToast.textContent === message) {
      el.globalToast.classList.add('hidden');
    }
  }, 2800);
}

function updateBezelClock(): void {
  el.hwClock.textContent = new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function renderCompanion(state: PulseState): void {
  const isInitialRender = currentState === null;
  currentState = state;

  el.pillTg.textContent = state.status.telegramConnected
    ? `Telegram: @${state.status.telegramBotUsername}`
    : 'Telegram: Demo Mode';
  el.pillTg.className = `pill ${state.status.telegramConnected ? 'pill-live' : 'pill-muted'}`;

  el.pillAi.textContent = state.status.aiLive
    ? `AI: ${state.status.aiProvider.toUpperCase()}`
    : 'AI: Demo Engine';
  el.pillAi.className = `pill ${state.status.aiLive ? 'pill-live' : 'pill-muted'}`;

  if (state.status.telegramPairedChatId && !el.cfgTgChat.value) {
    el.cfgTgChat.value = state.status.telegramPairedChatId;
  }
  if (isInitialRender && state.status.aiProvider) {
    el.cfgAiProvider.value = state.status.aiProvider;
  }
  el.cfgTgToken.placeholder = state.status.hasTelegramToken
    ? 'Configured on server (leave blank to keep)'
    : '123456789:AAH...';
  el.cfgAiKey.placeholder = state.status.hasAiKey
    ? 'Configured on server (leave blank to keep)'
    : 'sk-or-... or AIza...';

  el.meetingCard.innerHTML = `
    <div class="meeting-top">
      <span class="meeting-title">📅 ${escapeHtml(state.nextMeeting.title)}</span>
      <span class="meeting-time">${escapeHtml(state.nextMeeting.timeLabel)}</span>
    </div>
    <p class="meeting-brief">AI Prep: ${escapeHtml(state.nextMeeting.brief)}</p>
  `;

  el.companionMessages.innerHTML = state.messages
    .map(
      (m) => `
      <div class="msg-card ${m.replied ? 'replied' : ''}">
        <div class="msg-top">
          <span class="msg-sender">${escapeHtml(m.senderName)} <span class="meta">· ${escapeHtml(m.chatTitle)}</span></span>
          <span class="prio prio-${m.priority}">${m.replied ? 'REPLIED' : m.priority}</span>
        </div>
        <p class="msg-text">${escapeHtml(m.text)}</p>
        <div class="draft-row">
          ${m.drafts
            .map(
              (d) =>
                `<button class="draft-btn" data-msg-id="${escapeHtml(m.id)}" data-reply="${escapeHtml(d.text)}">↳ ${escapeHtml(d.label)}</button>`
            )
            .join('')}
          <button class="btn-ghost" style="padding:4px 8px;font-size:0.74rem" data-focus-msg="${escapeHtml(m.id)}">Show on G2</button>
        </div>
      </div>`
    )
    .join('');

  el.companionMessages.querySelectorAll<HTMLButtonElement>('.draft-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      mutationEpoch += 1;
      const id = btn.dataset.msgId!;
      const reply = btn.dataset.reply!;
      const res = await api.sendReply(id, reply);
      await controller.syncState(res.state);
      renderCompanion(res.state);
      await controller.showToast(res.deliveredLive ? '✓ Sent LIVE via Telegram!' : '✓ Reply sent (Demo Mode)');
    });
  });

  el.companionMessages.querySelectorAll<HTMLButtonElement>('[data-focus-msg]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await controller.setView('MESSAGE', btn.dataset.focusMsg);
    });
  });

  el.companionTasks.innerHTML = state.tasks
    .map(
      (t) => `
      <div class="task-item ${t.done ? 'done' : ''}" data-task-id="${escapeHtml(t.id)}">
        <div class="task-left">
          <span>${t.done ? '☑' : '☐'}</span>
          <span>${escapeHtml(t.title)}</span>
        </div>
        <span class="meta">${escapeHtml(t.dueLabel)} · ${t.origin}</span>
      </div>`
    )
    .join('');

  el.companionTasks.querySelectorAll<HTMLElement>('.task-item').forEach((item) => {
    item.addEventListener('click', async () => {
      mutationEpoch += 1;
      const res = await api.toggleTask(item.dataset.taskId!);
      await controller.syncState(res.state);
      renderCompanion(res.state);
    });
  });
}

function startBrowserSpeech(): void {
  const SpeechCtor =
    (window as unknown as { SpeechRecognition?: new () => BrowserSpeechRecognition }).SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: new () => BrowserSpeechRecognition }).webkitSpeechRecognition;

  if (!SpeechCtor) {
    el.voiceInput.focus();
    return;
  }

  activeRecognition = new SpeechCtor();
  activeRecognition.lang = 'en-US';
  activeRecognition.interimResults = false;
  activeRecognition.onresult = async (event) => {
    const transcript = event.results[0]?.[0]?.transcript;
    if (transcript) {
      el.voiceInput.value = transcript;
      await runVoiceCommand(transcript);
    }
  };
  activeRecognition.onend = () => {
    el.voiceBtn.classList.remove('listening');
    void controller.setListening(false);
  };
  el.voiceBtn.classList.add('listening');
  activeRecognition.start();
}

function stopBrowserSpeech(): void {
  if (activeRecognition) {
    activeRecognition.stop();
    activeRecognition = null;
  }
  el.voiceBtn.classList.remove('listening');
}

async function runVoiceCommand(transcript: string): Promise<void> {
  if (!transcript.trim()) return;
  mutationEpoch += 1;
  const res = await api.sendVoiceCommand(transcript.trim());
  await controller.syncState(res.state);
  renderCompanion(res.state);
  await controller.setView('VOICE');
}

const controller = new EvenG2Controller({
  onSendReply: async (messageId, replyText) => {
    mutationEpoch += 1;
    const res = await api.sendReply(messageId, replyText);
    await controller.syncState(res.state);
    renderCompanion(res.state);
  },
  onToggleTask: async (taskId) => {
    mutationEpoch += 1;
    const res = await api.toggleTask(taskId);
    await controller.syncState(res.state);
    renderCompanion(res.state);
  },
  onVoiceStart: () => startBrowserSpeech(),
  onVoiceStop: () => stopBrowserSpeech(),
  onVoiceAudioCaptured: async (wavBase64) => {
    mutationEpoch += 1;
    const res = await api.sendVoiceAudio(wavBase64);
    await controller.syncState(res.state);
    renderCompanion(res.state);
    await controller.setView('VOICE');
  },
  onPushBriefToTelegram: async () => {
    mutationEpoch += 1;
    await api.pushBriefToTelegram();
  },
  onDeviceBattery: (batteryLevel) => {
    latestBatteryLevel = batteryLevel;
    if (batteryLevel !== null) {
      el.pillSdk.textContent = `SDK: G2 Live (${batteryLevel}%)`;
      el.pillSdk.className = 'pill pill-live';
    }
  },
  onRender: (page, hud, sdkConnected) => renderG2Mirror(page, hud, sdkConnected),
  onTelemetry: (entry) => pushTelemetry(entry),
});

// Wire UI controls
document.getElementById('hw-up')!.addEventListener('click', () => controller.simulateHardwareInput('SCROLL_UP'));
document.getElementById('hw-down')!.addEventListener('click', () => controller.simulateHardwareInput('SCROLL_DOWN'));
document.getElementById('hw-click')!.addEventListener('click', () => controller.simulateHardwareInput('CLICK', 'GLASSES_R'));
document.getElementById('hw-ring')!.addEventListener('click', () => controller.simulateHardwareInput('CLICK', 'RING'));
document.getElementById('hw-dbl')!.addEventListener('click', () => controller.simulateHardwareInput('DOUBLE_CLICK'));

document.getElementById('hw-menu')!.addEventListener('click', () => {
  el.g2MenuOverlay.classList.toggle('hidden');
});

el.g2MenuOverlay.querySelectorAll<HTMLButtonElement>('[data-menu-id]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const id = Number(btn.dataset.menuId || 1);
    el.g2MenuOverlay.classList.add('hidden');
    await controller.handleMenuSelect(id);
    if (id === 5) {
      showGlobalToast('✓ Work Brief pushed to Telegram');
    }
  });
});

const quickTaskForm = document.getElementById('quick-task-form') as HTMLFormElement;
const quickTaskInput = document.getElementById('quick-task-input') as HTMLInputElement;
quickTaskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = quickTaskInput.value.trim();
  if (!title) return;
  mutationEpoch += 1;
  const res = await api.addTask(title);
  quickTaskInput.value = '';
  await controller.syncState(res.state);
  renderCompanion(res.state);
  showGlobalToast(`✓ Added task: ${title}`);
});

el.voiceBtn.addEventListener('click', () => {
  if (el.voiceBtn.classList.contains('listening')) {
    void controller.simulateHardwareInput('LONG_PRESS_RELEASE');
  } else {
    void controller.simulateHardwareInput('LONG_PRESS');
  }
});

document.getElementById('btn-voice-send')!.addEventListener('click', () => {
  void runVoiceCommand(el.voiceInput.value);
});

el.voiceInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    void runVoiceCommand(el.voiceInput.value);
  }
});

document.querySelectorAll<HTMLButtonElement>('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const cmd = btn.dataset.voice || '';
    el.voiceInput.value = cmd;
    void runVoiceCommand(cmd);
  });
});

document.querySelectorAll<HTMLButtonElement>('.view-switcher .chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view as HudView;
    void controller.setView(view);
  });
});

document.querySelectorAll<HTMLButtonElement>('.tabs .tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab!;
    document.querySelectorAll('.tabs .tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${target}`)!.classList.add('active');
  });
});

document.getElementById('btn-sim-msg')!.addEventListener('click', async () => {
  mutationEpoch += 1;
  const res = await api.simulateMessage();
  await controller.syncState(res.state);
  renderCompanion(res.state);
  await controller.setView('INBOX');
  await controller.showToast('New urgent Telegram message triaged!');
});

document.getElementById('btn-push-brief')!.addEventListener('click', async () => {
  mutationEpoch += 1;
  const res = await api.pushBriefToTelegram();
  await controller.syncState(res.state);
  renderCompanion(res.state);
  const msg = res.deliveredLive ? '✓ Brief sent LIVE to Telegram!' : '✓ Brief pushed (Demo Mode)';
  await controller.showToast(msg);
  showGlobalToast(msg);
});

const calForm = document.getElementById('calendar-form') as HTMLFormElement;
const calFeedback = document.getElementById('cal-feedback')!;
calForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const icsUrl = (document.getElementById('cfg-ics-url') as HTMLInputElement).value.trim();
  const title = (document.getElementById('cfg-meet-title') as HTMLInputElement).value.trim();
  const timeLabel = (document.getElementById('cfg-meet-time') as HTMLInputElement).value.trim();

  if (icsUrl) {
    mutationEpoch += 1;
    calFeedback.textContent = 'Syncing ICS calendar...';
    const res = await api.syncCalendar(icsUrl);
    await controller.syncState(res.state);
    renderCompanion(res.state);
    calFeedback.textContent = res.ok
      ? `✓ Synced next meeting: ${res.state.nextMeeting.title}`
      : `⚠ ${res.error || 'Calendar sync failed'}`;
    return;
  }

  if (title || timeLabel) {
    mutationEpoch += 1;
    const res = await api.updateMeeting({ title, timeLabel });
    await controller.syncState(res.state);
    renderCompanion(res.state);
    calFeedback.textContent = `✓ Updated meeting: ${res.state.nextMeeting.title}`;
    return;
  }

  calFeedback.textContent = '⚠ Enter a public .ics URL, meeting title, or time label.';
});

el.btnReset.addEventListener('click', async () => {
  mutationEpoch += 1;
  el.btnReset.disabled = true;
  el.btnReset.textContent = 'Resetting...';
  try {
    const res = await api.resetDemo();
    el.voiceInput.value = '';
    renderCompanion(res.state);
    await controller.resetToHome(res.state, 'Demo reset cleanly');
  } finally {
    el.btnReset.disabled = false;
    el.btnReset.textContent = 'Reset Demo';
  }
});

el.cfgForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  mutationEpoch += 1;
  el.cfgFeedback.textContent = 'Connecting...';
  setApiBase(el.cfgApiBase.value);
  const payload: Parameters<typeof api.saveConfig>[0] = {
    telegramDefaultChatId: el.cfgTgChat.value.trim(),
    aiProvider: el.cfgAiProvider.value as AiProvider,
    aiModel: el.cfgAiModel.value.trim(),
  };
  if (el.cfgTgToken.value.trim()) {
    payload.telegramBotToken = el.cfgTgToken.value.trim();
  }
  if (el.cfgAiKey.value.trim()) {
    payload.aiApiKey = el.cfgAiKey.value.trim();
  }
  const res = await api.saveConfig(payload);
  if (res.ok) {
    el.cfgTgToken.value = '';
    el.cfgAiKey.value = '';
  }
  await controller.syncState(res.state);
  renderCompanion(res.state);
  const offlineSuffix = isOfflineMode() ? ' (Offline Standalone)' : '';
  el.cfgFeedback.textContent = res.ok
    ? res.state.status.telegramConnected
      ? `✓ Connected to Telegram @${res.state.status.telegramBotUsername}`
      : `✓ Settings saved (Demo Mode active${offlineSuffix})`
    : `⚠ ${res.error || 'Failed to connect'}`;
});

async function refreshLoop(): Promise<void> {
  const startEpoch = mutationEpoch;
  try {
    const state = await api.getState();
    if (startEpoch !== mutationEpoch) return;
    const changed = !currentState || JSON.stringify(state) !== JSON.stringify(currentState);
    if (changed) {
      renderCompanion(state);
      await controller.syncState(state);
    }
  } catch {
    // Ignore transient poll errors during dev restart
  }
}

// Keyboard shortcuts for smooth simulator / demo recording
window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A') return;
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    void controller.simulateHardwareInput('SCROLL_UP');
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    void controller.simulateHardwareInput('SCROLL_DOWN');
  } else if (e.key === 'Enter') {
    e.preventDefault();
    void controller.simulateHardwareInput('CLICK', 'RING');
  } else if (e.key === 'Escape') {
    e.preventDefault();
    void controller.simulateHardwareInput('DOUBLE_CLICK', 'GLASSES_R');
  }
});

async function boot(): Promise<void> {
  el.cfgApiBase.value = getApiBase();
  updateBezelClock();
  setInterval(updateBezelClock, 15_000);
  await controller.connectBridge();
  await refreshLoop();
  setInterval(() => void refreshLoop(), 3000);
}

void boot();

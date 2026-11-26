import {
  AudioInputSource,
  EventSourceType,
  OsEventTypeList,
  StartUpPageCreateResult,
  validateEvenHubPageContainer,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';
import type { PulseState } from '../../server/types.js';
import { buildHudPage, MENU_IDS, type HudState, type RenderedHudPage } from './layout.js';
import { encodePcm16ToWav, uint8ToBase64 } from './audio.js';

export interface TelemetryEntry {
  time: string;
  direction: 'TX' | 'RX' | 'SYS';
  message: string;
}

export interface HudCallbacks {
  onSendReply: (messageId: string, replyText: string) => Promise<void>;
  onToggleTask: (taskId: string) => Promise<void>;
  onVoiceStart: () => void;
  onVoiceStop: () => void;
  onVoiceAudioCaptured?: (wavBase64: string) => Promise<void>;
  onPushBriefToTelegram?: () => Promise<void>;
  onDeviceBattery?: (batteryLevel: number | null) => void;
  onRender: (page: RenderedHudPage, hud: HudState, sdkConnected: boolean) => void;
  onTelemetry: (entry: TelemetryEntry) => void;
}

export class EvenG2Controller {
  private bridge: EvenAppBridge | null = null;
  private sdkConnected = false;
  private startupCreated = false;
  private pulseState: PulseState | null = null;
  private pcmChunks: Uint8Array[] = [];
  private hud: HudState = {
    view: 'INBOX',
    selectedMessageId: null,
    selectedListIndex: 0,
    isListening: false,
    toastText: null,
  };
  private callbacks: HudCallbacks;

  constructor(callbacks: HudCallbacks) {
    this.callbacks = callbacks;
  }

  private log(direction: TelemetryEntry['direction'], message: string): void {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    this.callbacks.onTelemetry({ time, direction, message });
  }

  public getHudState(): HudState {
    return { ...this.hud };
  }

  public isSdkConnected(): boolean {
    return this.sdkConnected;
  }

  private hasNativeHost(): boolean {
    return (
      typeof window !== 'undefined' &&
      Boolean(
        (window as unknown as { flutter_inappwebview?: { callHandler?: unknown } }).flutter_inappwebview
          ?.callHandler
      )
    );
  }

  public async connectBridge(): Promise<boolean> {
    try {
      this.bridge = await waitForEvenAppBridge();
      this.bridge.onEvenHubEvent((event: EvenHubEvent) => {
        void this.handleNativeEvent(event);
      });
      this.bridge.onLaunchSource((source) => {
        this.log('RX', `LaunchSource: ${source}`);
      });
      this.bridge.onDeviceStatusChanged((status) => {
        this.log('RX', `DeviceStatus: ${status.connectType} (${status.batteryLevel ?? '?'}%)`);
        this.callbacks.onDeviceBattery?.(status.batteryLevel ?? null);
      });

      this.sdkConnected = this.hasNativeHost();
      if (this.sdkConnected) {
        try {
          const info = await this.bridge.getDeviceInfo();
          if (info?.status?.batteryLevel !== undefined) {
            this.callbacks.onDeviceBattery?.(info.status.batteryLevel);
          }
        } catch {
          // Optional hardware telemetry
        }
      }
      this.log(
        'SYS',
        this.sdkConnected
          ? 'Connected to EvenAppBridge (@evenrealities/even_hub_sdk v0.0.16)'
          : 'Browser Mirror Mode active (will auto-attach when Even G2 / evenhub-simulator host is present)'
      );
      return this.sdkConnected;
    } catch (err) {
      this.sdkConnected = false;
      this.log('SYS', `Bridge unavailable (${err instanceof Error ? err.message : 'unknown'}), using Mirror Mode`);
      return false;
    }
  }

  public async syncState(state: PulseState): Promise<void> {
    this.pulseState = state;
    if (
      !this.hud.selectedMessageId ||
      !state.messages.some((m) => m.id === this.hud.selectedMessageId)
    ) {
      this.hud.selectedMessageId = state.messages[0]?.id ?? null;
    }
    const page = buildHudPage(state, this.hud);
    const maxIndex = Math.max(0, page.listItems.length - 1);
    if (this.hud.selectedListIndex > maxIndex) {
      this.hud.selectedListIndex = maxIndex;
    }
    await this.render();
  }

  public async resetToHome(state: PulseState, toastText?: string): Promise<void> {
    this.pulseState = state;
    this.hud.view = 'INBOX';
    this.hud.selectedMessageId = state.messages[0]?.id ?? null;
    this.hud.selectedListIndex = 0;
    this.hud.isListening = false;
    this.pcmChunks = [];
    if (toastText) {
      await this.showToast(toastText);
      return;
    }
    this.hud.toastText = null;
    await this.render();
  }

  public async setView(view: HudState['view'], selectedMessageId?: string): Promise<void> {
    this.hud.view = view;
    this.hud.selectedListIndex = 0;
    if (selectedMessageId) {
      this.hud.selectedMessageId = selectedMessageId;
    }
    await this.render();
  }

  public async setListening(listening: boolean): Promise<void> {
    this.hud.isListening = listening;
    if (listening) {
      this.pcmChunks = [];
      this.hud.view = 'VOICE';
    }
    if (this.bridge && this.hasNativeHost()) {
      try {
        await this.bridge.audioControl(listening, AudioInputSource.Glasses);
        this.log('TX', `audioControl(${listening}, Glasses)`);
      } catch {
        this.log('SYS', 'audioControl fallback to browser mic');
      }
    }
    if (!listening && this.pcmChunks.length > 0 && this.callbacks.onVoiceAudioCaptured) {
      const wav = encodePcm16ToWav(this.pcmChunks, 16000);
      this.pcmChunks = [];
      this.log('TX', `Captured G2 PCM WAV (${wav.byteLength} bytes) -> /api/voice/audio`);
      await this.callbacks.onVoiceAudioCaptured(uint8ToBase64(wav));
    }
    await this.render();
  }

  public async showToast(text: string): Promise<void> {
    this.hud.toastText = text;
    await this.render();
    setTimeout(() => {
      if (this.hud.toastText === text) {
        this.hud.toastText = null;
        void this.render();
      }
    }, 3200);
  }

  public async simulateHardwareInput(
    action: 'SCROLL_UP' | 'SCROLL_DOWN' | 'CLICK' | 'DOUBLE_CLICK' | 'LONG_PRESS' | 'LONG_PRESS_RELEASE',
    source: 'GLASSES_R' | 'RING' = 'GLASSES_R'
  ): Promise<void> {
    const sourceEnum =
      source === 'RING' ? EventSourceType.TOUCH_EVENT_FROM_RING : EventSourceType.TOUCH_EVENT_FROM_GLASSES_R;
    const sourceLabel = source === 'RING' ? 'R1 Ring' : 'G2 Temple';
    this.log('RX', `${sourceLabel} -> ${action}`);

    if (action === 'LONG_PRESS') {
      await this.setListening(true);
      this.callbacks.onVoiceStart();
      return;
    }

    if (action === 'LONG_PRESS_RELEASE') {
      await this.setListening(false);
      this.callbacks.onVoiceStop();
      return;
    }

    if (action === 'DOUBLE_CLICK') {
      await this.handleDoubleClick();
      return;
    }

    if (action === 'SCROLL_UP') {
      this.hud.selectedListIndex = Math.max(0, this.hud.selectedListIndex - 1);
      await this.render();
      return;
    }

    if (action === 'SCROLL_DOWN') {
      const page = this.pulseState ? buildHudPage(this.pulseState, this.hud) : null;
      const maxIndex = Math.max(0, (page?.listItems.length || 1) - 1);
      this.hud.selectedListIndex = Math.min(maxIndex, this.hud.selectedListIndex + 1);
      await this.render();
      return;
    }

    if (action === 'CLICK') {
      void sourceEnum;
      await this.handlePrimaryClick(this.hud.selectedListIndex);
    }
  }

  public async handleMenuSelect(itemId: number): Promise<void> {
    this.log('RX', `menuItemClickEvent(itemID=${itemId})`);
    if (itemId === MENU_IDS.INBOX) {
      await this.setView('INBOX');
    } else if (itemId === MENU_IDS.BRIEF) {
      await this.setView('BRIEF');
    } else if (itemId === MENU_IDS.DIGEST) {
      await this.setView('DIGEST');
    } else if (itemId === MENU_IDS.VOICE) {
      await this.setView('VOICE');
    } else if (itemId === MENU_IDS.PUSH_BRIEF) {
      await this.callbacks.onPushBriefToTelegram?.();
      await this.showToast('✓ Work Brief sent to Telegram');
    }
  }

  private async handleNativeEvent(event: EvenHubEvent): Promise<void> {
    const rawPcm = event.audioEvent?.audioPcm as unknown;
    const pcmBytes =
      rawPcm instanceof Uint8Array
        ? rawPcm
        : Array.isArray(rawPcm)
          ? Uint8Array.from(rawPcm as number[])
          : null;
    if (pcmBytes && pcmBytes.byteLength > 0) {
      if (this.hud.isListening) {
        this.pcmChunks.push(pcmBytes);
      }
      return;
    }

    if (event.menuItemClickEvent?.itemID) {
      await this.handleMenuSelect(event.menuItemClickEvent.itemID);
      return;
    }

    if (event.listEvent) {
      const idx = event.listEvent.currentSelectItemIndex ?? this.hud.selectedListIndex;
      this.hud.selectedListIndex = idx;
      const et = event.listEvent.eventType;
      this.log('RX', `listEvent idx=${idx} type=${String(et)}`);
      if (et === OsEventTypeList.CLICK_EVENT) {
        await this.handlePrimaryClick(idx);
      } else if (et === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        await this.handleDoubleClick();
      } else if (this.pulseState) {
        // Avoid full BLE rebuildPageContainer flicker on native list scroll; only update mirror
        const page = buildHudPage(this.pulseState, this.hud);
        this.callbacks.onRender(page, this.getHudState(), this.sdkConnected);
      }
      return;
    }

    if (event.textEvent) {
      const et = event.textEvent.eventType;
      this.log('RX', `textEvent type=${String(et)}`);
      if (et === OsEventTypeList.CLICK_EVENT) {
        await this.handlePrimaryClick(0);
      } else if (et === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        await this.handleDoubleClick();
      }
      return;
    }

    if (event.sysEvent) {
      const et = event.sysEvent.eventType;
      const src =
        event.sysEvent.eventSource === EventSourceType.TOUCH_EVENT_FROM_RING ? 'RING' : 'GLASSES_R';
      this.log('RX', `sysEvent type=${String(et)} src=${src}`);
      if (et === OsEventTypeList.LONG_PRESS_EVENT) {
        await this.setListening(true);
        this.callbacks.onVoiceStart();
      } else if (et === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) {
        await this.setListening(false);
        this.callbacks.onVoiceStop();
      } else if (et === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        await this.handleDoubleClick();
      }
    }
  }

  private async handleDoubleClick(): Promise<void> {
    if (this.hud.view === 'MESSAGE' || this.hud.view === 'VOICE' || this.hud.view === 'DIGEST') {
      await this.setView('INBOX');
    } else if (this.hud.view === 'INBOX') {
      await this.setView('BRIEF');
    } else {
      await this.setView('INBOX');
    }
  }

  private async handlePrimaryClick(index: number): Promise<void> {
    if (!this.pulseState) return;

    if (this.hud.view === 'INBOX') {
      const msg = this.pulseState.messages[index];
      if (!msg) return;
      await this.setView('MESSAGE', msg.id);
      return;
    }

    if (this.hud.view === 'MESSAGE') {
      const msg = this.pulseState.messages.find((m) => m.id === this.hud.selectedMessageId);
      if (!msg) {
        await this.setView('INBOX');
        return;
      }
      const draft = msg.drafts[index];
      if (!draft) {
        await this.setView('INBOX');
        return;
      }
      const prevView = this.hud.view;
      const prevIdx = this.hud.selectedListIndex;
      this.hud.view = 'INBOX';
      this.hud.selectedListIndex = 0;
      try {
        await this.callbacks.onSendReply(msg.id, draft.text);
        await this.showToast(`✓ Sent "${draft.label}" to ${msg.senderName}`);
      } catch (err) {
        this.hud.view = prevView;
        this.hud.selectedListIndex = prevIdx;
        await this.showToast(`⚠ ${err instanceof Error ? err.message : 'Reply failed'}`);
      }
      return;
    }

    if (this.hud.view === 'BRIEF') {
      const task = this.pulseState.tasks[index];
      if (!task) return;
      await this.callbacks.onToggleTask(task.id);
      await this.showToast(`${task.done ? 'Reopened' : '✓ Completed'}: ${task.title}`);
      return;
    }

    if (this.hud.view === 'DIGEST' || this.hud.view === 'VOICE') {
      await this.setView('INBOX');
    }
  }

  public async render(): Promise<void> {
    if (!this.pulseState) return;
    const page = buildHudPage(this.pulseState, this.hud);

    const validation = validateEvenHubPageContainer(page.payload);
    if (!validation.valid) {
      this.log('SYS', `SDK validation warning: ${validation.message}`);
    }

    if (this.bridge && this.hasNativeHost()) {
      if (!this.sdkConnected) {
        this.sdkConnected = true;
        this.log('SYS', 'Even G2 / evenhub-simulator host attached dynamically');
      }
      try {
        if (!this.startupCreated) {
          const res = await this.bridge.createStartUpPageContainer(page.payload);
          this.startupCreated = res === StartUpPageCreateResult.success;
          this.log('TX', `createStartUpPageContainer(${this.hud.view}) -> ${res}`);
        } else {
          await this.bridge.rebuildPageContainer(page.payload);
          this.log('TX', `rebuildPageContainer(${this.hud.view})`);
        }
      } catch (err) {
        this.log('SYS', `Bridge render error: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }

    this.callbacks.onRender(page, this.getHudState(), this.sdkConnected);
  }
}

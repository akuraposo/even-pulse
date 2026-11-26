import type { RuntimeConfig } from './types.js';

export interface IncomingTelegramUpdate {
  updateId: number;
  chatId: string;
  chatTitle: string;
  senderName: string;
  senderHandle?: string;
  text: string;
  timestamp: string;
  callbackData?: string;
  callbackQueryId?: string;
}

export interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

export class TelegramBridge {
  private botToken = '';
  private botUsername: string | null = null;
  private offset = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollingInFlight = false;
  private lastPollAt: string | null = null;
  private onMessageCallback: ((msg: IncomingTelegramUpdate) => Promise<void>) | null = null;

  private redactSecret(text: string): string {
    if (!this.botToken) return text;
    return text.replaceAll(this.botToken, '[REDACTED]');
  }

  public setMessageHandler(cb: (msg: IncomingTelegramUpdate) => Promise<void>): void {
    this.onMessageCallback = cb;
  }

  public getStatus() {
    return {
      connected: Boolean(this.botToken && this.botUsername),
      botUsername: this.botUsername,
      lastPollAt: this.lastPollAt,
    };
  }

  public async configure(config: RuntimeConfig): Promise<{ ok: boolean; botUsername: string | null; error?: string }> {
    this.stopPolling();
    this.botToken = config.telegramBotToken.trim();
    this.botUsername = null;

    if (!this.botToken) {
      return { ok: true, botUsername: null };
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/getMe`, {
        signal: AbortSignal.timeout(8000),
      });
      const data = (await res.json()) as {
        ok: boolean;
        result?: { username?: string };
        description?: string;
      };
      if (!data.ok || !data.result?.username) {
        this.botToken = '';
        return { ok: false, botUsername: null, error: data.description || 'Invalid Telegram bot token' };
      }

      this.botUsername = data.result.username;
      await this.registerBotCommands();
      this.startPolling();
      return { ok: true, botUsername: this.botUsername };
    } catch (err) {
      const msg = this.redactSecret(err instanceof Error ? err.message : 'Network error connecting to Telegram');
      this.botToken = '';
      return {
        ok: false,
        botUsername: null,
        error: msg,
      };
    }
  }

  private async registerBotCommands(): Promise<void> {
    if (!this.botToken) return;
    try {
      await fetch(`https://api.telegram.org/bot${this.botToken}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commands: [
            { command: 'start', description: 'Pair this chat with EvenPulse G2 HUD' },
            { command: 'brief', description: 'Get your AI Work Brief & open tasks' },
            { command: 'urgent', description: 'Push a P0 alert straight to Even G2 glasses' },
            { command: 'task', description: 'Add a work task to your G2 Brief' },
          ],
        }),
      });
    } catch {
      // Non-fatal
    }
  }

  public startPolling(): void {
    if (!this.botToken || this.pollTimer) return;
    void this.pollOnce();
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, 3000);
  }

  public stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollOnce(): Promise<void> {
    if (!this.botToken || this.pollingInFlight) return;
    this.pollingInFlight = true;
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/getUpdates?timeout=0&offset=${this.offset}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok: boolean;
        result?: Array<{
          update_id: number;
          message?: {
            date: number;
            text?: string;
            chat: { id: number; title?: string; first_name?: string; username?: string };
            from?: { first_name?: string; last_name?: string; username?: string };
          };
          channel_post?: {
            date: number;
            text?: string;
            chat: { id: number; title?: string };
          };
          callback_query?: {
            id: string;
            data?: string;
            from?: { first_name?: string; last_name?: string; username?: string };
            message?: {
              date: number;
              chat: { id: number; title?: string; first_name?: string; username?: string };
            };
          };
        }>;
      };

      this.lastPollAt = new Date().toISOString();
      if (!data.ok || !Array.isArray(data.result)) return;

      for (const update of data.result) {
        this.offset = Math.max(this.offset, update.update_id + 1);

        // Handle inline keyboard button clicks inside Telegram
        if (update.callback_query?.message && update.callback_query.data) {
          const cq = update.callback_query;
          const chatObj = cq.message!.chat;
          const chatId = String(chatObj.id);
          const chatTitle =
            chatObj.title ||
            chatObj.first_name ||
            (chatObj.username ? `@${chatObj.username}` : `Chat ${chatId}`);
          const senderName = cq.from
            ? [cq.from.first_name, cq.from.last_name].filter(Boolean).join(' ') || cq.from.username || 'Telegram User'
            : chatTitle;

          await this.answerCallbackQuery(cq.id, 'Synced to Even G2 HUD');

          if (this.onMessageCallback) {
            await this.onMessageCallback({
              updateId: update.update_id,
              chatId,
              chatTitle,
              senderName,
              senderHandle: cq.from?.username ? `@${cq.from.username}` : undefined,
              text: cq.data || '',
              timestamp: new Date().toISOString(),
              callbackData: cq.data,
              callbackQueryId: cq.id,
            });
          }
          continue;
        }

        const msg = update.message || update.channel_post;
        if (!msg?.text) continue;

        const chatId = String(msg.chat.id);
        const chatObj = msg.chat as { id: number; title?: string; first_name?: string; username?: string };
        const chatTitle: string =
          chatObj.title ||
          chatObj.first_name ||
          (chatObj.username ? `@${chatObj.username}` : `Chat ${chatId}`);

        const from =
          'from' in msg
            ? (msg.from as { first_name?: string; last_name?: string; username?: string } | undefined)
            : undefined;
        const senderName: string = from
          ? [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Telegram User'
          : chatTitle;
        const senderHandle = from?.username ? `@${from.username}` : undefined;

        if (this.onMessageCallback) {
          await this.onMessageCallback({
            updateId: update.update_id,
            chatId,
            chatTitle,
            senderName,
            senderHandle,
            text: msg.text,
            timestamp: new Date(msg.date * 1000).toISOString(),
          });
        }
      }
    } catch {
      // Keep polling resilient on transient network errors
    } finally {
      this.pollingInFlight = false;
    }
  }

  public async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    if (!this.botToken) return;
    try {
      await fetch(`https://api.telegram.org/bot${this.botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
      });
    } catch {
      // Non-fatal
    }
  }

  public async sendMessage(
    chatId: string,
    text: string,
    inlineKeyboard?: TelegramInlineButton[][]
  ): Promise<{ deliveredLive: boolean; error?: string }> {
    if (!this.botToken || !chatId || chatId.startsWith('demo-')) {
      return { deliveredLive: false };
    }

    try {
      const payload: Record<string, unknown> = {
        chat_id: chatId,
        text,
      };
      if (inlineKeyboard && inlineKeyboard.length > 0) {
        payload.reply_markup = { inline_keyboard: inlineKeyboard };
      }

      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok: boolean; description?: string };
      if (!data.ok) {
        return { deliveredLive: false, error: data.description || 'Telegram sendMessage failed' };
      }
      return { deliveredLive: true };
    } catch (err) {
      return {
        deliveredLive: false,
        error: err instanceof Error ? err.message : 'Telegram network error',
      };
    }
  }
}

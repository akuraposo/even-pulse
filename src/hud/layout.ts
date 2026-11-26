import type {
  CreateStartUpPageContainer,
  ListContainerProperty,
  MenuContainerProperty,
  RebuildPageContainer,
  TextContainerProperty,
} from '@evenrealities/even_hub_sdk';
import type { PulseState } from '../../server/types.js';

export type HudView = 'INBOX' | 'MESSAGE' | 'BRIEF' | 'DIGEST' | 'VOICE';

export interface HudState {
  view: HudView;
  selectedMessageId: string | null;
  selectedListIndex: number;
  isListening: boolean;
  toastText: string | null;
}

export const HUD_WIDTH = 576;
export const HUD_HEIGHT = 288;

export const CONTAINER_IDS = {
  HEADER: 1,
  MAIN_LIST: 2,
  BODY_TEXT: 3,
  FOOTER: 4,
} as const;

export const MENU_IDS = {
  INBOX: 1,
  BRIEF: 2,
  DIGEST: 3,
  VOICE: 4,
  PUSH_BRIEF: 5,
} as const;

export function truncateHud(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 1)}…`;
}

export function buildMenuObject(): MenuContainerProperty {
  return {
    menuItems: [
      { itemID: MENU_IDS.INBOX, itemName: 'Telegram Inbox' },
      { itemID: MENU_IDS.BRIEF, itemName: 'AI Work Brief' },
      { itemID: MENU_IDS.DIGEST, itemName: 'Channel Digest' },
      { itemID: MENU_IDS.VOICE, itemName: 'Voice Copilot' },
      { itemID: MENU_IDS.PUSH_BRIEF, itemName: 'Send Brief to TG' },
    ],
  } as MenuContainerProperty;
}

export interface RenderedHudPage {
  payload: CreateStartUpPageContainer & RebuildPageContainer;
  listItems: string[];
  headerText: string;
  bodyText: string | null;
  footerText: string;
}

export function buildHudPage(state: PulseState, hud: HudState): RenderedHudPage {
  const unreadCount = state.messages.filter((m) => m.unread).length;
  const openTasks = state.tasks.filter((t) => !t.done).length;
  const tgBadge = state.status.telegramConnected ? 'TG:LIVE' : 'TG:DEMO';
  const menuObject = buildMenuObject();

  let headerText = `EVENPULSE  |  ${tgBadge}  |  ${unreadCount} UNREAD`;
  let bodyText: string | null = null;
  let listItems: string[] = [];
  let footerText = 'TAP: Open  |  2xTAP: Brief  |  HOLD: Voice';

  const textObject: TextContainerProperty[] = [];
  const listObject: ListContainerProperty[] = [];

  if (hud.view === 'INBOX') {
    headerText = `EVENPULSE INBOX (${unreadCount})  |  ${tgBadge}`;
    listItems = state.messages.slice(0, 5).map((m) => {
      const tag = m.replied ? 'OK' : m.priority;
      return truncateHud(`[${tag}] ${m.senderName}: ${m.summary}`, 44);
    });
    if (listItems.length === 0) {
      listItems = ['All caught up — zero urgent messages'];
    }
    footerText = hud.toastText
      ? truncateHud(hud.toastText, 52)
      : 'SCROLL: Pick  |  TAP: AI Reply  |  2xTAP: Brief';

    textObject.push(
      {
        containerID: CONTAINER_IDS.HEADER,
        containerName: 'header',
        xPosition: 12,
        yPosition: 6,
        width: 552,
        height: 32,
        content: headerText,
        textColor: 2,
        isEventCapture: 0,
        zOrderIndex: 1,
      } as TextContainerProperty,
      {
        containerID: CONTAINER_IDS.FOOTER,
        containerName: 'footer',
        xPosition: 12,
        yPosition: 250,
        width: 552,
        height: 30,
        content: footerText,
        textColor: 1,
        isEventCapture: 0,
        zOrderIndex: 3,
      } as TextContainerProperty
    );

    listObject.push({
      containerID: CONTAINER_IDS.MAIN_LIST,
      containerName: 'inbox-list',
      xPosition: 12,
      yPosition: 44,
      width: 552,
      height: 198,
      borderWidth: 1,
      borderColor: 1,
      borderRadius: 6,
      paddingLength: 6,
      isEventCapture: 1,
      zOrderIndex: 2,
      itemContainer: {
        itemCount: listItems.length,
        itemWidth: 536,
        isItemSelectBorderEn: 1,
        itemName: listItems,
      },
    } as ListContainerProperty);
  } else if (hud.view === 'MESSAGE') {
    const msg =
      state.messages.find((m) => m.id === hud.selectedMessageId) || state.messages[0];
    headerText = msg
      ? truncateHud(`[${msg.priority}] ${msg.senderName}  •  ${msg.chatTitle}`, 48)
      : 'MESSAGE';
    bodyText = msg
      ? truncateHud(msg.text, 130)
      : 'No message selected.';
    listItems = msg
      ? [
          ...msg.drafts.slice(0, 3).map((d) => truncateHud(`↳ ${d.label}: ${d.text}`, 44)),
          '< Back to Inbox',
        ]
      : ['< Back to Inbox'];
    footerText = hud.toastText
      ? truncateHud(hud.toastText, 52)
      : 'TAP: Send 1-Tap TG Reply  |  2xTAP: Back';

    textObject.push(
      {
        containerID: CONTAINER_IDS.HEADER,
        containerName: 'header',
        xPosition: 12,
        yPosition: 6,
        width: 552,
        height: 30,
        content: headerText,
        textColor: 2,
        isEventCapture: 0,
        zOrderIndex: 1,
      } as TextContainerProperty,
      {
        containerID: CONTAINER_IDS.BODY_TEXT,
        containerName: 'msg-body',
        xPosition: 12,
        yPosition: 40,
        width: 552,
        height: 82,
        borderWidth: 1,
        borderColor: 1,
        borderRadius: 6,
        paddingLength: 6,
        content: bodyText,
        textColor: 4,
        isEventCapture: 0,
        zOrderIndex: 2,
      } as TextContainerProperty,
      {
        containerID: CONTAINER_IDS.FOOTER,
        containerName: 'footer',
        xPosition: 12,
        yPosition: 252,
        width: 552,
        height: 28,
        content: footerText,
        textColor: 1,
        isEventCapture: 0,
        zOrderIndex: 4,
      } as TextContainerProperty
    );

    listObject.push({
      containerID: CONTAINER_IDS.MAIN_LIST,
      containerName: 'reply-list',
      xPosition: 12,
      yPosition: 128,
      width: 552,
      height: 118,
      paddingLength: 4,
      isEventCapture: 1,
      zOrderIndex: 3,
      itemContainer: {
        itemCount: listItems.length,
        itemWidth: 540,
        isItemSelectBorderEn: 1,
        itemName: listItems,
      },
    } as ListContainerProperty);
  } else if (hud.view === 'BRIEF') {
    headerText = `AI WORK BRIEF  |  ${openTasks} OPEN TASKS`;
    bodyText = `NEXT: ${truncateHud(state.nextMeeting.title, 32)} (${truncateHud(state.nextMeeting.timeLabel, 14)})\nPREP: ${truncateHud(state.nextMeeting.brief, 54)}`;
    listItems = state.tasks.slice(0, 4).map((t) =>
      truncateHud(`${t.done ? '[x]' : '[ ]'} ${t.dueLabel} ${t.title}`, 44)
    );
    if (listItems.length === 0) {
      listItems = ['[x] All tasks complete!'];
    }
    footerText = hud.toastText
      ? truncateHud(hud.toastText, 52)
      : 'TAP: Toggle Task  |  2xTAP: Inbox  |  HOLD: Voice';

    textObject.push(
      {
        containerID: CONTAINER_IDS.HEADER,
        containerName: 'header',
        xPosition: 12,
        yPosition: 6,
        width: 552,
        height: 30,
        content: headerText,
        textColor: 2,
        isEventCapture: 0,
        zOrderIndex: 1,
      } as TextContainerProperty,
      {
        containerID: CONTAINER_IDS.BODY_TEXT,
        containerName: 'meeting-brief',
        xPosition: 12,
        yPosition: 40,
        width: 552,
        height: 76,
        borderWidth: 1,
        borderColor: 1,
        borderRadius: 6,
        paddingLength: 6,
        content: bodyText,
        textColor: 4,
        isEventCapture: 0,
        zOrderIndex: 2,
      } as TextContainerProperty,
      {
        containerID: CONTAINER_IDS.FOOTER,
        containerName: 'footer',
        xPosition: 12,
        yPosition: 252,
        width: 552,
        height: 28,
        content: footerText,
        textColor: 1,
        isEventCapture: 0,
        zOrderIndex: 4,
      } as TextContainerProperty
    );

    listObject.push({
      containerID: CONTAINER_IDS.MAIN_LIST,
      containerName: 'task-list',
      xPosition: 12,
      yPosition: 122,
      width: 552,
      height: 124,
      paddingLength: 4,
      isEventCapture: 1,
      zOrderIndex: 3,
      itemContainer: {
        itemCount: listItems.length,
        itemWidth: 540,
        isItemSelectBorderEn: 1,
        itemName: listItems,
      },
    } as ListContainerProperty);
  } else if (hud.view === 'DIGEST') {
    headerText = `TELEGRAM AI DIGEST  |  3 KEY UPDATES`;
    bodyText = state.channelDigest
      .slice(0, 3)
      .map((line, i) => `${i + 1}. ${truncateHud(line, 48)}`)
      .join('\n\n');
    footerText = 'TAP: Back to Inbox  |  2xTAP: Work Brief';

    textObject.push(
      {
        containerID: CONTAINER_IDS.HEADER,
        containerName: 'header',
        xPosition: 12,
        yPosition: 6,
        width: 552,
        height: 30,
        content: headerText,
        textColor: 2,
        isEventCapture: 0,
        zOrderIndex: 1,
      } as TextContainerProperty,
      {
        containerID: CONTAINER_IDS.BODY_TEXT,
        containerName: 'digest-body',
        xPosition: 12,
        yPosition: 44,
        width: 552,
        height: 198,
        borderWidth: 1,
        borderColor: 1,
        borderRadius: 6,
        paddingLength: 8,
        content: bodyText || 'No channel updates yet.',
        textColor: 4,
        isEventCapture: 1,
        zOrderIndex: 2,
      } as TextContainerProperty,
      {
        containerID: CONTAINER_IDS.FOOTER,
        containerName: 'footer',
        xPosition: 12,
        yPosition: 250,
        width: 552,
        height: 30,
        content: footerText,
        textColor: 1,
        isEventCapture: 0,
        zOrderIndex: 3,
      } as TextContainerProperty
    );
  } else {
    // VOICE view
    headerText = hud.isListening
      ? '● G2 MIC ACTIVE  |  SPEAK COMMAND'
      : 'VOICE COPILOT  |  ACTION RESULT';
    bodyText = hud.isListening
      ? 'Listening via Even G2 Beamforming Mic...\n\nTry: "Reply to Alex I am joining in 5 mins"\nOr: "Add task to review PR 48"'
      : state.lastVoiceAction
      ? `${state.lastVoiceAction.headline}\n\n${state.lastVoiceAction.detail}\n\nHeard: "${truncateHud(state.lastVoiceAction.transcript, 46)}"`
      : 'Hold Temple or R1 Ring to speak a Telegram reply or work task.';
    footerText = hud.isListening
      ? 'RELEASE: Execute AI Command'
      : 'TAP: Back to Inbox  |  HOLD: Speak Again';

    textObject.push(
      {
        containerID: CONTAINER_IDS.HEADER,
        containerName: 'header',
        xPosition: 12,
        yPosition: 6,
        width: 552,
        height: 30,
        content: headerText,
        textColor: hud.isListening ? 4 : 2,
        isEventCapture: 0,
        zOrderIndex: 1,
      } as TextContainerProperty,
      {
        containerID: CONTAINER_IDS.BODY_TEXT,
        containerName: 'voice-body',
        xPosition: 12,
        yPosition: 44,
        width: 552,
        height: 198,
        borderWidth: 1,
        borderColor: 1,
        borderRadius: 6,
        paddingLength: 8,
        content: bodyText,
        textColor: 4,
        isEventCapture: 1,
        zOrderIndex: 2,
      } as TextContainerProperty,
      {
        containerID: CONTAINER_IDS.FOOTER,
        containerName: 'footer',
        xPosition: 12,
        yPosition: 250,
        width: 552,
        height: 30,
        content: footerText,
        textColor: 1,
        isEventCapture: 0,
        zOrderIndex: 3,
      } as TextContainerProperty
    );
  }

  const containerTotalNum = textObject.length + listObject.length;
  const payload = {
    containerTotalNum,
    textObject,
    ...(listObject.length > 0 ? { listObject } : {}),
    menuObject,
  } as CreateStartUpPageContainer & RebuildPageContainer;

  return {
    payload,
    listItems,
    headerText,
    bodyText,
    footerText,
  };
}

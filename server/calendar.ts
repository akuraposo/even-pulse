import type { MeetingItem } from './types.js';

function parseIcsDate(raw: string): Date | null {
  const clean = raw.trim().replace(/^TZID=[^:]+:/i, '');
  const match = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, isUtc] = match;
  if (isUtc) {
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  }
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

function formatCountdown(target: Date, now: Date): string {
  const diffMin = Math.max(0, Math.round((target.getTime() - now.getTime()) / 60_000));
  const hh = String(target.getHours()).padStart(2, '0');
  const mm = String(target.getMinutes()).padStart(2, '0');
  if (diffMin === 0) return `Now (${hh}:${mm})`;
  if (diffMin < 60) return `In ${diffMin}m (${hh}:${mm})`;
  const hrs = Math.floor(diffMin / 60);
  const rem = diffMin % 60;
  return `In ${hrs}h${rem > 0 ? ` ${rem}m` : ''} (${hh}:${mm})`;
}

export function parseNextMeetingFromIcs(icsText: string, now = new Date()): MeetingItem | null {
  const unfolded = icsText.replace(/\r?\n[ \t]/g, '');
  const blocks = unfolded.split('BEGIN:VEVENT').slice(1);

  const upcoming: Array<{ start: Date; title: string; description: string }> = [];

  for (const block of blocks) {
    const body = block.split('END:VEVENT')[0] || '';
    const dtStartMatch = body.match(/DTSTART(?:;[^:]+)?:([^\r\n]+)/i);
    const summaryMatch = body.match(/SUMMARY(?:;[^:]+)?:([^\r\n]+)/i);
    const descMatch = body.match(/DESCRIPTION(?:;[^:]+)?:([^\r\n]+)/i);

    if (!dtStartMatch || !summaryMatch) continue;
    const start = parseIcsDate(dtStartMatch[1]);
    if (!start || start.getTime() < now.getTime() - 10 * 60_000) continue;

    upcoming.push({
      start,
      title: summaryMatch[1].replace(/\\,/g, ',').replace(/\\n/g, ' ').trim(),
      description: (descMatch?.[1] || '').replace(/\\,/g, ',').replace(/\\n/g, ' ').trim(),
    });
  }

  upcoming.sort((a, b) => a.start.getTime() - b.start.getTime());
  const next = upcoming[0];
  if (!next) return null;

  return {
    id: `ics-${next.start.getTime()}`,
    title: next.title.slice(0, 40),
    timeLabel: formatCountdown(next.start, now),
    attendees: 'Synced via ICS Calendar',
    brief: (next.description || `Synced from calendar: ${next.title}`).slice(0, 80),
  };
}

export function assertPublicCalendarUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid calendar URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Calendar URL must use http or https');
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^0\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error('Blocked private or local calendar URL');
  }
  return parsed;
}

export async function fetchNextMeetingFromIcsUrl(icsUrl: string): Promise<MeetingItem | null> {
  const safeUrl = assertPublicCalendarUrl(icsUrl);
  const res = await fetch(safeUrl.toString(), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`Calendar ICS HTTP ${res.status}`);
  }
  const text = await res.text();
  if (text.length > 2_000_000) {
    throw new Error('ICS calendar file too large (>2 MB)');
  }
  return parseNextMeetingFromIcs(text);
}

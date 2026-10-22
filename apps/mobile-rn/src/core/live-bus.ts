import { Platform } from 'react-native';

/**
 * Live organizer events (judges → displays, timers, calls), design 2026-10-22. Until the server has socket rooms for
 * competitions, events travel on this device only: in the page, and to the other tabs of the same browser through
 * BroadcastChannel (TV displays opened next to the judge or organizer tab). Channel and event names are the future
 * socket's (docs/organisation-backend-contract.md). Displays never rely on events alone: they load a snapshot first.
 */

export type LiveListener = (payload: unknown) => void;

export interface LiveBus {
  subscribe(channel: string, event: string, listener: LiveListener): () => void;
  publish(channel: string, event: string, payload: unknown): void;
}

/** The part of BroadcastChannel the bus uses (a port never hears its own messages). */
export interface BroadcastLike {
  postMessage(data: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

type Message = { channel: string; event: string; payload: unknown };

export const LIVE_CHANNEL_NAME = 'fl-live';

/**
 * BroadcastChannel in web pages only. Phones and tests keep events in the page: Node (jest) has a BroadcastChannel
 * too, and an open one would keep the test process alive.
 */
export function browserChannel(): BroadcastLike | null {
  if (Platform.OS !== 'web' || typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(LIVE_CHANNEL_NAME) as unknown as BroadcastLike;
}

export class LocalLiveBus implements LiveBus {
  private readonly listeners = new Map<string, Set<LiveListener>>();

  constructor(private readonly port: BroadcastLike | null = browserChannel()) {
    if (port) port.onmessage = (ev) => this.deliver(ev.data as Message);
  }

  subscribe(channel: string, event: string, listener: LiveListener): () => void {
    const key = `${channel}\n${event}`;
    const set = this.listeners.get(key) ?? new Set<LiveListener>();
    set.add(listener);
    this.listeners.set(key, set);
    return () => void set.delete(listener);
  }

  publish(channel: string, event: string, payload: unknown): void {
    const message: Message = { channel, event, payload };
    this.deliver(message);
    this.port?.postMessage(message);
  }

  private deliver(m: Message) {
    if (!m || typeof m.channel !== 'string' || typeof m.event !== 'string') return;
    this.listeners.get(`${m.channel}\n${m.event}`)?.forEach((l) => l(m.payload));
  }
}

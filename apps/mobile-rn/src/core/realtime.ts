import { io, type Socket } from 'socket.io-client';

type Listener<T> = (value: T) => void;

/** Live events from the API WebSocket `/ws` (docs §4.5): new notifications and battle score changes. */
export interface Realtime {
  onNotification(listener: Listener<Record<string, unknown>>): () => void;
  onBattleScore(listener: Listener<string>): () => void;
  connect(): void;
  disconnect(): void;
  subscribeBattle(battleId: string): void;
  unsubscribeBattle(battleId: string): void;
}

class Emitter<T> {
  private listeners = new Set<Listener<T>>();
  on(l: Listener<T>) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
  emit(v: T) {
    this.listeners.forEach((l) => l(v));
  }
}

/** Tests, demo build and signed-out state: nothing live, screens fall back to polling. */
export class NoopRealtime implements Realtime {
  onNotification() {
    return () => {};
  }
  onBattleScore() {
    return () => {};
  }
  connect() {}
  disconnect() {}
  subscribeBattle() {}
  unsubscribeBattle() {}
}

export class SocketRealtime implements Realtime {
  private readonly url: string;
  private readonly notifications = new Emitter<Record<string, unknown>>();
  private readonly battleScores = new Emitter<string>();
  private readonly battles = new Set<string>();
  private socket: Socket | null = null;

  constructor(apiBaseUrl: string, private readonly token: () => string | null) {
    this.url = `${new URL(apiBaseUrl).origin}/ws`;
  }

  onNotification(l: Listener<Record<string, unknown>>) {
    return this.notifications.on(l);
  }
  onBattleScore(l: Listener<string>) {
    return this.battleScores.on(l);
  }

  connect() {
    if (this.socket || !this.token()) return;
    // The access token rotates: every (re)connection reads the current one.
    const s = io(this.url, { transports: ['websocket'], auth: (cb) => cb({ token: this.token() }), reconnection: true });
    s.on('connect', () => this.battles.forEach((id) => s.emit('battle.subscribe', { battleId: id })));
    s.on('notification.new', (data: unknown) => {
      if (data && typeof data === 'object') this.notifications.emit(data as Record<string, unknown>);
    });
    s.on('battle.score', (data: { battleId?: unknown }) => {
      if (typeof data?.battleId === 'string') this.battleScores.emit(data.battleId);
    });
    this.socket = s;
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }

  subscribeBattle(battleId: string) {
    this.battles.add(battleId);
    this.socket?.emit('battle.subscribe', { battleId });
  }

  unsubscribeBattle(battleId: string) {
    this.battles.delete(battleId);
    this.socket?.emit('battle.unsubscribe', { battleId });
  }
}

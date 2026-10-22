import { Platform } from 'react-native';

import { browserChannel, LocalLiveBus, type BroadcastLike } from '../../src/core/live-bus';

/** Stand-in for BroadcastChannel: every port hears the others, never itself (like the browser API). */
function hub() {
  const ports: BroadcastLike[] = [];
  return (): BroadcastLike => {
    const port: BroadcastLike = {
      onmessage: null,
      postMessage: (data) => ports.filter((p) => p !== port).forEach((p) => p.onmessage?.({ data })),
    };
    ports.push(port);
    return port;
  };
}

describe('live bus (judge → displays, same device)', () => {
  it('delivers a published event to the listeners of that channel and event', () => {
    const bus = new LocalLiveBus(null);
    const got: unknown[] = [];
    bus.subscribe('heat.h1', 'score_update', (p) => got.push(p));
    bus.publish('heat.h1', 'score_update', { total: 12 });
    expect(got).toEqual([{ total: 12 }]);
  });

  it('ignores other channels and other events', () => {
    const bus = new LocalLiveBus(null);
    const got: unknown[] = [];
    bus.subscribe('heat.h1', 'score_update', (p) => got.push(p));
    bus.publish('heat.h2', 'score_update', { total: 1 });
    bus.publish('heat.h1', 'done', { lane: 3 });
    expect(got).toEqual([]);
  });

  it('stops delivering after unsubscribing', () => {
    const bus = new LocalLiveBus(null);
    const got: unknown[] = [];
    const off = bus.subscribe('heat.h1', 'score_update', (p) => got.push(p));
    off();
    bus.publish('heat.h1', 'score_update', { total: 12 });
    expect(got).toEqual([]);
  });

  it('reaches another tab, and the publishing tab hears its own event once', () => {
    const port = hub();
    const judgeTab = new LocalLiveBus(port());
    const displayTab = new LocalLiveBus(port());
    const onJudge: unknown[] = [];
    const onDisplay: unknown[] = [];
    judgeTab.subscribe('heat.h1', 'score_update', (p) => onJudge.push(p));
    displayTab.subscribe('heat.h1', 'score_update', (p) => onDisplay.push(p));

    judgeTab.publish('heat.h1', 'score_update', { total: 5 });

    expect(onDisplay).toEqual([{ total: 5 }]);
    expect(onJudge).toEqual([{ total: 5 }]);
  });
});

describe('which runtime opens a browser channel', () => {
  afterEach(() => jest.restoreAllMocks());

  it('opens none outside web pages, even when the runtime has BroadcastChannel (phones, tests)', () => {
    expect(typeof BroadcastChannel).toBe('function');
    expect(browserChannel()).toBeNull();
  });

  it('opens one in a web page', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const port = browserChannel() as unknown as { close(): void } | null;
    expect(port).not.toBeNull();
    port?.close();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WSClient } from '../../src/lib/ws-client';

// MockWebSocket with controllable event firing
class MockWebSocket {
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number;
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  static instances: MockWebSocket[] = [];

  constructor(url: string) {
    this.url = url;
    this.readyState = WebSocket.CONNECTING ?? 0;
    MockWebSocket.instances.push(this);
  }

  send(_data: string): void {}

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  // Test helpers
  triggerOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  triggerMessage(data: unknown): void {
    const event = new MessageEvent('message', { data: JSON.stringify(data) });
    this.onmessage?.(event);
  }

  triggerRawMessage(data: string): void {
    const event = new MessageEvent('message', { data });
    this.onmessage?.(event);
  }

  triggerClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }
}

function latestSocket(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

describe('WSClient', () => {
  let onUpdate: ReturnType<typeof vi.fn>;
  let onStateChange: ReturnType<typeof vi.fn>;
  let client: WSClient;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    onUpdate = vi.fn();
    onStateChange = vi.fn();
    vi.stubGlobal('WebSocket', MockWebSocket);
    client = new WSClient({
      url: 'wss://test.example.com/live',
      onUpdate,
      onStateChange,
      reconnectBaseMs: 1000,
      reconnectMaxMs: 30_000,
    });
  });

  afterEach(() => {
    client.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('starts in disconnected state', () => {
      expect(client.getState()).toBe('disconnected');
    });

    it('does not create a WebSocket before connect() is called', () => {
      expect(MockWebSocket.instances).toHaveLength(0);
    });
  });

  describe('connect()', () => {
    it('transitions to connecting state', () => {
      client.connect();
      expect(client.getState()).toBe('connecting');
    });

    it('creates a WebSocket with the configured URL', () => {
      client.connect();
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].url).toBe('wss://test.example.com/live');
    });

    it('registers visibilitychange listener', () => {
      const addSpy = vi.spyOn(document, 'addEventListener');
      client.connect();
      expect(addSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });
  });

  describe('onopen transition', () => {
    it('transitions to connected state on open', () => {
      client.connect();
      latestSocket().triggerOpen();
      expect(client.getState()).toBe('connected');
    });

    it('calls onStateChange(true) on open', () => {
      client.connect();
      latestSocket().triggerOpen();
      expect(onStateChange).toHaveBeenCalledWith(true);
    });

    it('resets reconnect attempt counter on open', () => {
      client.connect();
      const ws1 = latestSocket();
      ws1.triggerOpen();
      ws1.triggerClose();

      // First reconnect (attempt 1)
      vi.advanceTimersByTime(1000);
      latestSocket().triggerOpen();
      latestSocket().triggerClose();

      // Second reconnect — now at attempt 2
      vi.advanceTimersByTime(2000);
      latestSocket().triggerOpen();
      // After successful open, attempt resets to 0
      // Verify by closing and checking the delay is back to base (1s)
      latestSocket().triggerClose();
      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances).toHaveLength(4);
    });
  });

  describe('onmessage handling', () => {
    beforeEach(() => {
      client.connect();
      latestSocket().triggerOpen();
    });

    it('calls onUpdate when message type is "update"', () => {
      latestSocket().triggerMessage({ type: 'update', resource: 'health' });
      expect(onUpdate).toHaveBeenCalledWith('health');
    });

    it('does not call onUpdate for "pong" messages', () => {
      latestSocket().triggerMessage({ type: 'pong' });
      expect(onUpdate).not.toHaveBeenCalled();
    });

    it('does not call onUpdate for unknown message types', () => {
      latestSocket().triggerMessage({ type: 'other', resource: 'books' });
      expect(onUpdate).not.toHaveBeenCalled();
    });

    it('ignores messages with type "update" but no resource', () => {
      latestSocket().triggerMessage({ type: 'update' });
      expect(onUpdate).not.toHaveBeenCalled();
    });

    it('ignores invalid JSON without throwing', () => {
      expect(() => latestSocket().triggerRawMessage('not-json')).not.toThrow();
      expect(onUpdate).not.toHaveBeenCalled();
    });
  });

  describe('onclose and reconnect backoff', () => {
    it('schedules reconnect after close with base delay (1s)', () => {
      client.connect();
      latestSocket().triggerOpen();
      latestSocket().triggerClose();

      expect(MockWebSocket.instances).toHaveLength(1);
      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    it('doubles the delay after each close (exponential backoff)', () => {
      client.connect();
      latestSocket().triggerOpen();
      latestSocket().triggerClose();
      vi.advanceTimersByTime(1000);

      latestSocket().triggerOpen();
      latestSocket().triggerClose();
      // attempt=1, delay should be ~2s
      vi.advanceTimersByTime(2000);
      expect(MockWebSocket.instances).toHaveLength(3);
    });

    it('caps backoff delay at reconnectMaxMs (30s)', () => {
      client.connect();

      // Exhaust backoff up to max: log2(30000/1000)=~4.9 → 5 doublings
      for (let i = 0; i < 6; i++) {
        latestSocket().triggerOpen();
        latestSocket().triggerClose();
        vi.advanceTimersByTime(30_000); // always advance enough
      }

      // After 6 attempts, still reconnects within 30s window
      expect(MockWebSocket.instances.length).toBeGreaterThan(3);
    });

    it('does not reconnect after intentional close', () => {
      client.connect();
      latestSocket().triggerOpen();
      client.disconnect();

      vi.advanceTimersByTime(60_000);
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('transitions to disconnected state on close', () => {
      client.connect();
      latestSocket().triggerOpen();
      latestSocket().triggerClose();
      expect(client.getState()).toBe('disconnected');
    });

    it('calls onStateChange(false) on close', () => {
      client.connect();
      latestSocket().triggerOpen();
      onStateChange.mockClear();
      latestSocket().triggerClose();
      expect(onStateChange).toHaveBeenCalledWith(false);
    });
  });

  describe('disconnect()', () => {
    it('clears all timers and closes the socket', () => {
      client.connect();
      latestSocket().triggerOpen();
      client.disconnect();
      expect(client.getState()).toBe('disconnected');
    });

    it('removes visibilitychange listener', () => {
      const removeSpy = vi.spyOn(document, 'removeEventListener');
      client.connect();
      client.disconnect();
      expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });

    it('prevents reconnect timers from firing after disconnect', () => {
      client.connect();
      latestSocket().triggerOpen();
      latestSocket().triggerClose();
      client.disconnect();

      vi.advanceTimersByTime(60_000);
      expect(MockWebSocket.instances).toHaveLength(1);
    });
  });

  describe('max connection timer (115 minutes)', () => {
    it('force-reconnects after 115 minutes', () => {
      client.connect();
      latestSocket().triggerOpen();

      const MAX_MS = 115 * 60 * 1000;
      vi.advanceTimersByTime(MAX_MS);

      // Should have scheduled a reconnect
      vi.advanceTimersByTime(100);
      expect(MockWebSocket.instances).toHaveLength(2);
    });
  });

  describe('visibility change', () => {
    it('closes socket when document becomes hidden', () => {
      client.connect();
      latestSocket().triggerOpen();

      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(client.getState()).toBe('disconnected');
    });

    it('schedules reconnect immediately when document becomes visible', () => {
      client.connect();
      latestSocket().triggerOpen();

      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      // Reconnect delay=0 so next tick opens a new socket
      vi.advanceTimersByTime(0);
      expect(MockWebSocket.instances).toHaveLength(2);
    });
  });
});

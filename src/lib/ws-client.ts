export type WSMessageHandler = (resource: string) => void;

export interface WSClientOptions {
  url: string;
  onUpdate: WSMessageHandler;
  onStateChange?: (connected: boolean) => void;
  heartbeatIntervalMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

export type WSState = 'connecting' | 'connected' | 'disconnected';

const DEFAULT_HEARTBEAT_MS = 5 * 60 * 1000;
const DEFAULT_RECONNECT_BASE_MS = 1000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;
const MAX_CONNECTION_MS = 115 * 60 * 1000;

export class WSClient {
  private ws: WebSocket | null = null;
  private state: WSState = 'disconnected';
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private maxConnectionTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private intentionalClose = false;
  private visibilityHandler: (() => void) | null = null;
  private opts: Required<WSClientOptions>;

  constructor(opts: WSClientOptions) {
    this.opts = {
      onStateChange: () => {},
      heartbeatIntervalMs: DEFAULT_HEARTBEAT_MS,
      reconnectBaseMs: DEFAULT_RECONNECT_BASE_MS,
      reconnectMaxMs: DEFAULT_RECONNECT_MAX_MS,
      ...opts,
    };
  }

  connect(): void {
    this.intentionalClose = false;
    this.openSocket();

    this.visibilityHandler = () => {
      if (document.hidden) {
        this.intentionalClose = true;
        this.closeSocket();
      } else {
        this.intentionalClose = false;
        this.scheduleReconnect(0);
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearAllTimers();
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    this.closeSocket();
  }

  getState(): WSState {
    return this.state;
  }

  private openSocket(): void {
    this.setState('connecting');
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.setState('connected');
      this.startHeartbeat();
      this.startMaxConnectionTimer();
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as { type?: string; resource?: string };
        if (msg.type === 'update' && msg.resource) {
          this.opts.onUpdate(msg.resource);
        }
        // Ignore 'pong' and unknown types
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      this.clearHeartbeat();
      this.clearMaxConnectionTimer();
      this.setState('disconnected');
      if (!this.intentionalClose) {
        this.scheduleReconnect(this.currentDelay());
        this.advanceBackoff();
      }
    };

    ws.onerror = () => {
      // onclose fires after onerror; reconnection handled there
    };
  }

  private closeSocket(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.clearHeartbeat();
    this.clearMaxConnectionTimer();
    this.setState('disconnected');
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: 'ping' }));
      }
    }, this.opts.heartbeatIntervalMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startMaxConnectionTimer(): void {
    this.clearMaxConnectionTimer();
    this.maxConnectionTimer = setTimeout(() => {
      // Force close and reconnect after 1h55m
      this.intentionalClose = false;
      this.closeSocket();
      this.scheduleReconnect(0);
    }, MAX_CONNECTION_MS);
  }

  private clearMaxConnectionTimer(): void {
    if (this.maxConnectionTimer) {
      clearTimeout(this.maxConnectionTimer);
      this.maxConnectionTimer = null;
    }
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionalClose) {
        this.openSocket();
      }
    }, delayMs);
  }

  private currentDelay(): number {
    const base = Math.min(
      this.opts.reconnectBaseMs * Math.pow(2, this.reconnectAttempt),
      this.opts.reconnectMaxMs,
    );
    return base * (0.5 + Math.random() * 0.5);
  }

  private advanceBackoff(): void {
    const maxAttempts = Math.ceil(Math.log2(this.opts.reconnectMaxMs / this.opts.reconnectBaseMs));
    if (this.reconnectAttempt < maxAttempts) {
      this.reconnectAttempt++;
    }
  }

  private clearAllTimers(): void {
    this.clearHeartbeat();
    this.clearMaxConnectionTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(next: WSState): void {
    if (this.state === next) return;
    this.state = next;
    this.opts.onStateChange?.(next === 'connected');
  }
}

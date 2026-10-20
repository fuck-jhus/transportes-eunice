export interface FleetSocket {
  readyState: number;
  bufferedAmount?: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send: (data: string) => void;
  close: () => void;
}

// All async completions and retry callbacks are bound to this connection's lifetime.
export const createFleetConnection = (options: {
  open: () => Promise<FleetSocket>;
  onMessage: (data: any) => void;
  sync: () => void;
  now?: () => number;
}) => {
  let stopped = false;
  let socket: FleetSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let lastMessageAt = 0;
  let generation = 0;
  const now = options.now ?? Date.now;

  const schedule = () => {
    if (stopped || retry) return;
    retry = setTimeout(() => { retry = null; void connect(); }, Math.min(30_000, 1_000 * 2 ** Math.min(attempts++, 5)));
  };
  const disposeSocket = () => {
    const old = socket;
    socket = null;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      old.close();
    }
  };
  const connect = async () => {
    const currentGeneration = ++generation;
    try {
      const next = await options.open();
      if (stopped || currentGeneration !== generation) { next.close(); return; }
      socket = next;
      lastMessageAt = now();
      next.onopen = () => {
        if (stopped || socket !== next) return;
        attempts = 0;
        lastMessageAt = now();
        options.sync();
        next.send(JSON.stringify({ tipo: 'ping' }));
      };
      next.onmessage = event => {
        if (stopped || socket !== next) return;
        lastMessageAt = now();
        try { options.onMessage(JSON.parse(event.data)); } catch { /* Ignore malformed frames only. */ }
      };
      const failed = () => {
        if (stopped || socket !== next) return;
        disposeSocket();
        schedule();
      };
      next.onclose = failed;
      next.onerror = failed;
    } catch { if (!stopped && currentGeneration === generation) schedule(); }
  };
  const heartbeat = setInterval(() => {
    if (!socket || socket.readyState !== 1) return;
    if (now() - lastMessageAt > 60_000) { disposeSocket(); schedule(); return; }
    try { socket.send(JSON.stringify({ tipo: 'ping' })); } catch { disposeSocket(); schedule(); }
  }, 20_000);
  const syncTimer = setInterval(() => { if (!stopped) options.sync(); }, 15_000);
  options.sync();
  void connect();
  return {
    send: (payload: unknown): boolean => {
      if (stopped || !socket || socket.readyState !== 1 || (socket.bufferedAmount ?? 0) > 64_000) return false;
      try { socket.send(JSON.stringify(payload)); return true; }
      catch { disposeSocket(); schedule(); return false; }
    },
    resume: () => {
      if (stopped) return;
      ++generation;
      if (retry) clearTimeout(retry);
      retry = null;
      disposeSocket();
      options.sync();
      void connect();
    },
    stop: () => {
      stopped = true;
      ++generation;
      if (retry) clearTimeout(retry);
      clearInterval(heartbeat);
      clearInterval(syncTimer);
      disposeSocket();
    },
  };
};

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export interface ServerOptions {
  pluginName?: string;
  metroPort?: number;
  commandTimeoutMs?: number;
}

export function startAgentBridgeMcpServer(options: ServerOptions = {}) {
  const PLUGIN_NAME = options.pluginName ?? process.env.EXPO_AGENT_BRIDGE_PLUGIN ?? 'expo-agent-bridge';
  const METRO_PORT = options.metroPort ?? Number(process.env.EXPO_METRO_PORT ?? 8081);
  const PROTOCOL_VERSION = 1;
  const COMMAND_TIMEOUT_MS = options.commandTimeoutMs ?? 30000;

  let commandSeq = 0;
  const pendingCommands = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void; timer: any }>();

  // ─── In-memory log buffer ───────────────────────────────────────────────────

  const recentLogs: Array<{ level: string; message: string; stack?: string; timestamp: number }> = [];
  const MAX_LOGS = 100;

  function addLog(entry: any) {
    if (!entry) return;
    recentLogs.push(entry);
    if (recentLogs.length > MAX_LOGS) recentLogs.shift();
  }

  // ─── DevTools Plugin WebSocket connection ───────────────────────────────────

  let ws: any = null;
  let wsReady = false;
  let connectionPromise: Promise<void> | null = null;
  const browserClientId = Date.now().toString();

  function packMessage(method: string, payload: any) {
    const messageKey = { pluginName: PLUGIN_NAME, method };
    return JSON.stringify({ messageKey, payload });
  }

  function unpackMessage(data: any) {
    if (typeof data === 'string') return JSON.parse(data);
    return null;
  }

  function sendHandshake() {
    ws.send(
      JSON.stringify({
        __isHandshakeMessages: true,
        protocolVersion: PROTOCOL_VERSION,
        pluginName: PLUGIN_NAME,
        method: 'handshake',
        browserClientId,
      })
    );
  }

  function connectToMetro(): Promise<void> {
    if (connectionPromise) return connectionPromise;

    connectionPromise = new Promise((resolve, reject) => {
      const url = `ws://localhost:${METRO_PORT}/expo-dev-plugins/broadcast`;
      process.stderr.write(`[expo-agent-bridge] Connecting to ${url}\n`);

      ws = new WebSocket(url);

      ws.addEventListener('open', () => {
        wsReady = true;
        sendHandshake();
        process.stderr.write('[expo-agent-bridge] Connected to DevTools broadcast channel ✓\n');
        resolve();
      });

      ws.addEventListener('message', (event: any) => {
        const raw = event.data;
        let msg: any;
        try {
          msg = unpackMessage(typeof raw === 'string' ? raw : raw.toString());
        } catch {
          return;
        }
        if (!msg) return;

        if (msg.__isHandshakeMessages) return;

        const { messageKey, payload } = msg;
        if (!messageKey || messageKey.pluginName !== PLUGIN_NAME) return;

        // Real-time log/error streamed from app
        if (messageKey.method === 'log') {
          addLog(payload);
          return;
        }

        if (messageKey.method !== 'result') return;

        const pending = pendingCommands.get(payload?.id);
        if (!pending) return;

        clearTimeout(pending.timer);
        pendingCommands.delete(payload.id);

        if (payload.error) {
          pending.reject(new Error(payload.error));
        } else {
          pending.resolve(payload);
        }
      });

      ws.addEventListener('close', () => {
        wsReady = false;
        connectionPromise = null;
        ws = null;
        process.stderr.write('[expo-agent-bridge] DevTools connection closed — will reconnect on next tool call\n');
        for (const [id, pending] of pendingCommands) {
          clearTimeout(pending.timer);
          pending.reject(new Error('Connection closed while waiting for phone response'));
          pendingCommands.delete(id);
        }
      });

      ws.addEventListener('error', (e: any) => {
        process.stderr.write(`[expo-agent-bridge] WS error: ${e?.message ?? 'connection failed'}\n`);
        connectionPromise = null;
        reject(e);
      });
    });

    return connectionPromise;
  }

  async function sendCommand(action: string, params: Record<string, any> = {}) {
    try {
      await connectToMetro();
    } catch (e: any) {
      throw new Error(
        `Cannot connect to Metro dev server on port ${METRO_PORT}. ` +
          `Make sure 'npx expo start' is running. (${e.message})`
      );
    }

    if (!wsReady) {
      throw new Error('DevTools connection not ready. Is expo running and the dev app open on phone/simulator?');
    }

    // The app-side DevTools listener needs a brief moment after the broadcast
    // handshake before it can reliably receive the first command. The direct
    // CLI uses the same delay; keeping both transports aligned avoids a
    // first-call race in MCP clients.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const id = String(++commandSeq);
    const cmd = { id, action, ...params };

    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCommands.delete(id);
        const lastError = recentLogs.slice().reverse().find((l) => l.level === 'error');
        let msg = `Timed out after ${COMMAND_TIMEOUT_MS / 1000}s waiting for phone response. Is the dev app open?`;
        if (lastError) {
          msg += `\n[Recent App Error]: ${lastError.message}`;
          if (lastError.stack) msg += `\n${lastError.stack}`;
        }
        reject(new Error(msg));
      }, COMMAND_TIMEOUT_MS);

      pendingCommands.set(id, { resolve, reject, timer });
      ws.send(packMessage('command', cmd));
    });
  }

  function triggerMetroReload(): Promise<void> {
    return new Promise((resolve) => {
      try {
        const reloadWs = new WebSocket(`ws://localhost:${METRO_PORT}/message`);
        reloadWs.addEventListener('open', () => {
          reloadWs.send(JSON.stringify({ version: 2, method: 'reload' }));
          setTimeout(() => {
            try {
              reloadWs.close();
            } catch {}
            resolve();
          }, 300);
        });
        reloadWs.addEventListener('error', () => resolve());
      } catch {
        resolve();
      }
    });
  }

  // ─── MCP Server ─────────────────────────────────────────────────────────────

  const mcp = new McpServer({ name: 'expo-agent-bridge', version: '0.1.0' });

  mcp.tool(
    'get_screenshot',
    'Capture the current mobile screen as a PNG. Returns base64 image data. If the app crashed or timed out, recent error logs will be included.',
    {},
    async () => {
      const res = await sendCommand('screenshot');
      if (!res.data) throw new Error('No image data returned from app.');
      return { content: [{ type: 'image', data: res.data, mimeType: 'image/png' }] };
    }
  );

  mcp.tool(
    'get_logs',
    'Get recent console errors, warnings, and unhandled exceptions streamed from the app.',
    {
      level: z.enum(['error', 'warn', 'all']).optional().describe('Filter by log level (default: "all")'),
      limit: z.number().optional().describe('Maximum entries to return (default: 30)'),
    },
    async ({ level = 'all', limit = 30 }) => {
      let logs = recentLogs;
      if (level === 'error') logs = logs.filter((l) => l.level === 'error');
      else if (level === 'warn') logs = logs.filter((l) => l.level === 'error' || l.level === 'warn');

      const entries = logs.slice(-limit);
      if (entries.length === 0) {
        return { content: [{ type: 'text', text: 'No logs recorded.' }] };
      }
      const text = entries
        .map((e) => {
          const time = new Date(e.timestamp).toLocaleTimeString();
          let s = `[${time}] [${e.level.toUpperCase()}] ${e.message}`;
          if (e.stack) s += `\n${e.stack}`;
          return s;
        })
        .join('\n\n');
      return { content: [{ type: 'text', text }] };
    }
  );

  mcp.tool(
    'reload',
    'Reload the app bundle on the phone. Triggers both Metro reload broadcast and in-app DevSettings.reload.',
    {},
    async () => {
      await triggerMetroReload();
      try {
        await sendCommand('reload');
      } catch {}
      return { content: [{ type: 'text', text: 'App reload triggered successfully.' }] };
    }
  );

  mcp.tool(
    'get_route',
    'Get the current active route, pathname, and segments from Expo Router.',
    {},
    async () => {
      const res = await sendCommand('get_route');
      return { content: [{ type: 'text', text: JSON.stringify(res.route, null, 2) }] };
    }
  );

  mcp.tool(
    'get_elements',
    'List all currently mounted interactive UI elements (testIDs, titles, types) on screen.',
    {},
    async () => {
      const res = await sendCommand('get_elements');
      const elements = res.elements || [];
      if (elements.length === 0) {
        return { content: [{ type: 'text', text: 'No interactive elements registered on current screen.' }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(elements, null, 2) }] };
    }
  );

  mcp.tool(
    'get_state',
    'Inspect app custom state or stores exposed to the bridge.',
    {},
    async () => {
      const res = await sendCommand('get_state');
      if (res.error) throw new Error(res.error);
      return { content: [{ type: 'text', text: JSON.stringify(res.state, null, 2) }] };
    }
  );

  mcp.tool(
    'reset_storage',
    'Clear AsyncStorage on the device to test clean first-time install experience.',
    {},
    async () => {
      const res = await sendCommand('reset_storage');
      if (res.error) throw new Error(res.error);
      return { content: [{ type: 'text', text: 'AsyncStorage cleared.' }] };
    }
  );

  mcp.tool(
    'open_dev_menu',
    'Open the developer menu on the phone without shaking the device.',
    {},
    async () => {
      try {
        await sendCommand('open_dev_menu');
      } catch {}
      return { content: [{ type: 'text', text: 'Developer menu triggered.' }] };
    }
  );

  mcp.tool(
    'navigate',
    'Navigate to an Expo Router route in the app.',
    { route: z.string().describe('Route path (e.g. "/settings")') },
    async ({ route }) => {
      await sendCommand('navigate', { route });
      return { content: [{ type: 'text', text: `Navigated to ${route}` }] };
    }
  );

  mcp.tool(
    'tap',
    'Tap an element by its testID prop.',
    { target: z.string().describe('testID of the element') },
    async ({ target }) => {
      const res = await sendCommand('tap', { target });
      if (!res.success) throw new Error(`Element "${target}" not found or has no onPress.`);
      return { content: [{ type: 'text', text: `Tapped "${target}"` }] };
    }
  );

  mcp.tool(
    'scroll',
    'Scroll the active scroll view up or down.',
    {
      direction: z.enum(['up', 'down']),
      amount: z.number().optional().describe('Pixels to scroll (default 300)'),
    },
    async ({ direction, amount = 300 }) => {
      await sendCommand('scroll', { direction, amount });
      return { content: [{ type: 'text', text: `Scrolled ${direction} ${amount}px` }] };
    }
  );

  mcp.tool(
    'type_text',
    'Type text into a TextInput by testID.',
    {
      target: z.string().describe('testID of TextInput'),
      text: z.string().describe('Text to type'),
    },
    async ({ target, text }) => {
      const res = await sendCommand('type', { target, text });
      if (!res.success) throw new Error(`Input "${target}" not found or has no onChangeText handler.`);
      return { content: [{ type: 'text', text: `Typed "${text}" into "${target}"` }] };
    }
  );

  async function run() {
    const transport = new StdioServerTransport();
    await mcp.connect(transport);
    process.stderr.write(
      `[expo-agent-bridge] MCP server running. DevTools plugin: ${PLUGIN_NAME}, Metro port: ${METRO_PORT}\n`
    );
  }

  run().catch((e) => {
    process.stderr.write(`[expo-agent-bridge] fatal: ${e.message}\n`);
    process.exit(1);
  });
}

import fs from 'fs';

export type BridgeResponse = Record<string, any>;

export interface BridgeClientOptions {
  metroPort?: number;
  pluginName?: string;
  timeoutMs?: number;
}

/** Send one command to the already-running Expo DevTools bridge and exit. */
export function sendBridgeCommand(action: string, params: Record<string, any> = {}, options: BridgeClientOptions = {}) {
  const port = options.metroPort ?? Number(process.env.EXPO_METRO_PORT ?? 8081);
  const pluginName = options.pluginName ?? process.env.EXPO_AGENT_BRIDGE_PLUGIN ?? 'expo-agent-bridge';
  const timeoutMs = options.timeoutMs ?? 30000;

  return new Promise<BridgeResponse>((resolve, reject) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const browserClientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url = `ws://localhost:${port}/expo-dev-plugins/broadcast`;
    let settled = false;
    let socket: any;
    const finish = (error?: Error, response?: BridgeResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.close(); } catch {}
      error ? reject(error) : resolve(response ?? {});
    };
    const timer = setTimeout(() => finish(new Error(`Timed out after ${timeoutMs / 1000}s waiting for the Expo app. Is Expo running and the dev app open?`)), timeoutMs);

    try {
      socket = new WebSocket(url);
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ __isHandshakeMessages: true, protocolVersion: 1, pluginName, method: 'handshake', browserClientId }));
        // Give the Expo app's DevTools client a moment to finish its handshake.
        // One-shot CLI calls otherwise race the app listener; the original
        // temporary clients avoided this with a short post-handshake delay.
        setTimeout(() => {
          if (!settled && socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ messageKey: { pluginName, method: 'command' }, payload: { id, action, ...params } }));
          }
        }, 250);
      });
      socket.addEventListener('message', (event: any) => {
        let message: any;
        try { message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString()); } catch { return; }
        if (message?.messageKey?.pluginName !== pluginName || message.messageKey.method !== 'result' || message.payload?.id !== id) return;
        if (message.payload.error) finish(new Error(message.payload.error));
        else finish(undefined, message.payload);
      });
      socket.addEventListener('error', () => finish(new Error(`Cannot connect to Metro at ${url}. Make sure Expo is running.`)));
      socket.addEventListener('close', () => { if (!settled) finish(new Error('The Expo DevTools connection closed before the app responded.')); });
    } catch (error: any) { finish(new Error(`Cannot connect to Metro at ${url}: ${error.message}`)); }
  });
}

export function writeScreenshot(response: BridgeResponse, outputPath: string) {
  if (!response.data) throw new Error('The app did not return screenshot data.');
  fs.writeFileSync(outputPath, Buffer.from(response.data, 'base64'));
}

import React, { useEffect, useRef } from 'react';
import { ScrollView, DevSettings, NativeModules } from 'react-native';

export const PLUGIN_NAME = 'expo-agent-bridge';

export type ElementHandler = {
  ref?: React.RefObject<any>;
  onPress?: () => void;
  onChangeText?: (text: string) => void;
  type?: string;
  title?: string;
};

export type LogEntry = {
  level: 'error' | 'warn' | 'log';
  message: string;
  stack?: string;
  timestamp: number;
};

const MAX_LOGS = 100;
export const logBuffer: LogEntry[] = [];
export const elementRegistry = new Map<string, ElementHandler>();

export function registerElement(testID: string, handler: ElementHandler | React.RefObject<any>) {
  if (typeof __DEV__ !== 'undefined' && !__DEV__) return;
  if (handler && 'current' in handler) {
    elementRegistry.set(testID, { ref: handler });
  } else {
    const originalOnPress = handler.onPress;
    const wrappedHandler: ElementHandler = {
      ...handler,
      onPress: originalOnPress
        ? () => {
            const label = handler.title ? `"${handler.title}" (${testID})` : `"${testID}"`;
            recordLog('log', `[Interaction] Pressed ${label}`);
            return originalOnPress();
          }
        : undefined,
    };
    elementRegistry.set(testID, wrappedHandler);
  }
}

export function unregisterElement(testID: string) {
  if (typeof __DEV__ !== 'undefined' && !__DEV__) return;
  elementRegistry.delete(testID);
}

/**
 * Hook to declaratively register any interactive component with the agent bridge.
 * Example:
 *   useAgentElement('my-button', { onPress, title: 'Submit' });
 */
export function useAgentElement(testID: string, handler: ElementHandler) {
  useEffect(() => {
    if (typeof __DEV__ !== 'undefined' && !__DEV__) return;
    registerElement(testID, handler);
    return () => unregisterElement(testID);
  }, [testID, handler.onPress, handler.onChangeText, handler.title]);
}

// ─── Route Tracking ───────────────────────────────────────────────────────────

let currentRouteState: { pathname: string; segments: string[] } = {
  pathname: '/',
  segments: [],
};

// ─── Log & Error Monitoring ───────────────────────────────────────────────────

let isLogging = false;
let activeClient: any = null;

function recordLog(level: 'error' | 'warn' | 'log', message: string, stack?: string) {
  if (isLogging) return;
  isLogging = true;
  try {
    const entry: LogEntry = {
      level,
      message,
      stack,
      timestamp: Date.now(),
    };
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();

    if (activeClient && activeClient.isConnected?.()) {
      activeClient.sendMessage('log', entry);
    }
  } catch {
    // Ignore logging errors
  } finally {
    isLogging = false;
  }
}

function formatArgs(args: any[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

// Hook console and ErrorUtils once in DEV mode
if (typeof __DEV__ !== 'undefined' && __DEV__ && !(global as any).__expoAgentBridgeLogsHooked) {
  (global as any).__expoAgentBridgeLogsHooked = true;

  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;

  console.error = (...args: any[]) => {
    const msg = formatArgs(args);
    if (!msg.startsWith('[AgentBridge]') && !msg.startsWith('[DevAgentBridge]')) {
      const errorObj = args.find((a) => a instanceof Error);
      recordLog('error', msg, errorObj?.stack);
    }
    originalError(...args);
  };

  console.warn = (...args: any[]) => {
    const msg = formatArgs(args);
    if (!msg.startsWith('[AgentBridge]') && !msg.startsWith('[DevAgentBridge]')) {
      recordLog('warn', msg);
    }
    originalWarn(...args);
  };

  console.log = (...args: any[]) => {
    const msg = formatArgs(args);
    recordLog('log', msg);
    originalLog(...args);
  };

  const ErrorUtils = (global as any).ErrorUtils;
  if (ErrorUtils && typeof ErrorUtils.getGlobalHandler === 'function') {
    const defaultHandler = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
      const message = error?.message ? `${error.name || 'Error'}: ${error.message}` : String(error);
      recordLog('error', `[Unhandled ${isFatal ? 'Fatal ' : ''}Exception] ${message}`, error?.stack);
      defaultHandler?.(error, isFatal);
    });
  }
}

// ─── Command dispatch ─────────────────────────────────────────────────────────

async function handleCommand(cmd: Record<string, any>): Promise<Record<string, any>> {
  const { id, action } = cmd;

  switch (action) {
    case 'screenshot': {
      console.log('[expo-agent-bridge] ← screenshot');
      recordLog('log', '[Bridge] Screenshot captured');
      const { captureScreen } = require('react-native-view-shot');
      const base64 = await captureScreen({ format: 'png', result: 'base64' });
      return { id, data: base64 };
    }

    case 'navigate': {
      console.log(`[expo-agent-bridge] ← navigate ${cmd.route}`);
      recordLog('log', `[Bridge] Navigate to ${cmd.route}`);
      try {
        const { router } = require('expo-router');
        router.push(cmd.route);
        return { id, success: true };
      } catch (e: any) {
        recordLog('error', `[Bridge] Navigate error: ${e?.message}`);
        return { id, error: 'Expo Router not available: ' + e?.message };
      }
    }

    case 'get_route': {
      return { id, route: currentRouteState };
    }

    case 'get_elements': {
      const elements = Array.from(elementRegistry.entries()).map(([testID, handler]) => ({
        testID,
        type: handler.type || (handler.onPress ? 'button' : handler.onChangeText ? 'input' : 'element'),
        title: handler.title,
      }));
      return { id, elements };
    }

    case 'get_state': {
      try {
        // Look for common stores or custom global state
        const stateObj: Record<string, any> = {};
        if ((global as any).__AGENT_CUSTOM_STATE__) {
          stateObj.custom = (global as any).__AGENT_CUSTOM_STATE__();
        }
        return { id, state: stateObj };
      } catch (err: any) {
        return { id, error: err.message };
      }
    }

    case 'reset_storage': {
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        await AsyncStorage.clear();
        recordLog('log', '[Bridge] Storage reset cleared');
        return { id, success: true };
      } catch (err: any) {
        return { id, error: err.message };
      }
    }

    case 'open_dev_menu': {
      try {
        if (NativeModules.DevMenu?.show) {
          NativeModules.DevMenu.show();
        }
      } catch {}
      return { id, success: true };
    }

    case 'tap': {
      console.log(`[expo-agent-bridge] ← tap "${cmd.target}"`);
      const handler = elementRegistry.get(cmd.target as string);
      if (handler?.onPress) {
        recordLog('log', `[Bridge] Tap "${cmd.target}" (${handler.title || 'button'})`);
        handler.onPress();
        return { id, success: true };
      }
      const node = handler?.ref?.current as any;
      if (typeof node?.props?.onPress === 'function') {
        recordLog('log', `[Bridge] Tap "${cmd.target}" via ref`);
        node.props.onPress();
        return { id, success: true };
      }
      recordLog('warn', `[Bridge] Tap "${cmd.target}" failed: not found in element registry`);
      return { id, success: false };
    }

    case 'scroll': {
      console.log(`[expo-agent-bridge] ← scroll ${cmd.direction}`);
      recordLog('log', `[Bridge] Scroll ${cmd.direction}`);
      for (const [, handler] of elementRegistry) {
        const node = handler?.ref?.current;
        if (node && 'scrollToEnd' in node) {
          const sv = node as ScrollView;
          if (cmd.direction === 'down') sv.scrollToEnd({ animated: true });
          else sv.scrollTo({ y: 0, animated: true });
          return { id, success: true };
        }
      }
      return { id, success: false };
    }

    case 'type': {
      console.log(`[expo-agent-bridge] ← type "${cmd.target}": "${cmd.text}"`);
      recordLog('log', `[Bridge] Type into "${cmd.target}": "${cmd.text}"`);
      const handler = elementRegistry.get(cmd.target as string);
      if (handler?.onChangeText) {
        handler.onChangeText(cmd.text as string);
        return { id, success: true };
      }
      const node = handler?.ref?.current as any;
      if (typeof node?.props?.onChangeText === 'function') {
        node.props.onChangeText(cmd.text as string);
        return { id, success: true };
      }
      return { id, success: false };
    }

    case 'get_logs': {
      return { id, logs: logBuffer };
    }

    case 'reload': {
      console.log('[expo-agent-bridge] ← reload');
      recordLog('log', '[Bridge] App reload requested');
      if (typeof DevSettings?.reload === 'function') {
        DevSettings.reload('Agent requested reload');
      }
      return { id, success: true };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

export interface AgentBridgeProps {
  pluginName?: string;
}

export function AgentBridge({ pluginName = PLUGIN_NAME }: AgentBridgeProps) {
  // If production, render nothing and initialize nothing
  if (typeof __DEV__ !== 'undefined' && !__DEV__) {
    return null;
  }

  return <DevAgentBridgeImpl pluginName={pluginName} />;
}

function DevAgentBridgeImpl({ pluginName }: { pluginName: string }) {
  let client: any = null;
  try {
    const { useDevToolsPluginClient } = require('@expo/devtools');
    client = useDevToolsPluginClient(pluginName);
  } catch (e) {
    console.warn('[AgentBridge] @expo/devtools not available in this environment');
  }

  const subRef = useRef<{ remove: () => void } | null>(null);

  // Attempt to hook Expo Router if present
  try {
    const { usePathname, useSegments } = require('expo-router');
    const pathname = usePathname();
    const segments = useSegments();
    useEffect(() => {
      currentRouteState = { pathname, segments };
    }, [pathname, segments]);
  } catch {
    // Non-Expo-Router app fallback
  }

  useEffect(() => {
    if (!client) return;

    activeClient = client;
    console.log(`[AgentBridge] Connected via DevTools Plugin (${pluginName}) ✓`);
    recordLog('log', `AgentBridge initialized and connected (${pluginName})`);

    subRef.current = client.addMessageListener('command', async (cmd: Record<string, any>) => {
      let result: Record<string, any>;
      try {
        result = await handleCommand(cmd);
      } catch (err: any) {
        result = { id: cmd.id, error: err?.message ?? String(err) };
      }
      client.sendMessage('result', result);
    });

    return () => {
      activeClient = null;
      subRef.current?.remove();
    };
  }, [client, pluginName]);

  return null;
}

export default AgentBridge;

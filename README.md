# expo-agent-bridge 🌉

**Autonomous AI Agent Dev Bridge for Expo & React Native apps.**

Give AI coding agents (Antigravity, Cursor, Claude Code, Windsurf, Devin) complete visual feedback and device control over your live running mobile app — **without USB cables, without custom tunnels, and fully compatible with WSL & Wi-Fi.**

---

## ✨ Features

- 📸 **Live Visual Feedback (`get_screenshot`)**: Real-time full-screen captures directly from physical devices or simulators.
- 🪵 **Real-Time Error Streaming (`get_logs`)**: Captures `console.error`, `console.warn`, and unhandled JS exceptions with full stack traces.
- 🔁 **Dual-Layer Reload (`reload`)**: Reloads the app via Metro broadcast and in-app `DevSettings.reload` (works even if JS thread is stuck).
- 🧭 **Navigation Control (`navigate` & `get_route`)**: Navigate Expo Router screens and verify active route segments.
- 🎯 **Targeted Element Interaction (`tap`, `scroll`, `type_text`)**: Interacts with UI components via `testID` or hooks without fragile pixel-coordinate guessing.
- 🔍 **Element Discovery (`get_elements`)**: Lists all currently mounted interactive buttons and inputs on screen.
- 🧹 **Storage & State Reset (`reset_storage`, `get_state`)**: Clears AsyncStorage on the fly to test clean first-install experience.
- 🪶 **Zero Production Footprint**: Evaluates to `null` and empty functions when `!__DEV__`.

---

## 🚀 Quickstart

### 1. Install as a dev dependency in your Expo project

```bash
# Using npm
npm install --save-dev expo-agent-bridge react-native-view-shot

# Using yarn
yarn add --dev expo-agent-bridge react-native-view-shot
```

### 2. Initialize Agent Config & Skills

Run in your project root:

```bash
npx expo-agent-bridge init
```

This automatically generates:
- `.agents/mcp_config.json` (MCP server configuration)
- `.agents/skills/expo-agent-bridge/SKILL.md` (instructions for AI agents)

### 3. Mount in your Root Layout

In your root layout (e.g. `app/_layout.tsx` or `App.tsx`):

```tsx
import { AgentBridge } from 'expo-agent-bridge';

export default function RootLayout() {
  return (
    <>
      <AgentBridge />
      {/* Rest of your app */}
    </>
  );
}
```

### 4. Run Expo

```bash
npx expo start
# Or on WSL:
npx expo start --tunnel
```

Scan the QR code with your iPhone/Android device. Your AI agent can now immediately inspect and control the app!

---

## 🛠️ MCP Tools

| Tool | Description |
|---|---|
| `get_screenshot()` | Captures current mobile screen as PNG base64 |
| `get_logs(level?, limit?)` | Streams recent `console.error`, `console.warn`, and exceptions |
| `reload()` | Reloads the JS bundle on device |
| `get_route()` | Returns active route, pathname, and segments from Expo Router |
| `get_elements()` | Lists all mounted interactive elements |
| `get_state()` | Inspects exposed custom state |
| `reset_storage()` | Clears AsyncStorage to test first-time launch |
| `open_dev_menu()` | Opens React Native developer menu on device |
| `navigate(route)` | Pushes an Expo Router route |
| `tap(target)` | Taps element matching `testID` |
| `scroll(direction, amount?)` | Scrolls active scroll view up/down |
| `type_text(target, text)` | Types text into TextInput |

---

## 🧩 Element Registration

Components with `testID` can be registered declaratively:

```tsx
import { useAgentElement } from 'expo-agent-bridge';

function CustomButton({ onPress, title }) {
  useAgentElement('my-btn', { onPress, title, type: 'button' });

  return (
    <TouchableOpacity testID="my-btn" onPress={onPress}>
      <Text>{title}</Text>
    </TouchableOpacity>
  );
}
```

Or imperatively:

```tsx
import { registerElement, unregisterElement } from 'expo-agent-bridge';

registerElement('submit-btn', { onPress: handleSubmit, title: 'Submit' });
```

---

## 🏗️ Architecture

```
AI Coding Agent (Antigravity / Cursor / Claude)
      │
      │ MCP stdio protocol
      ▼
npx expo-agent-bridge mcp
      │
      │ WebSocket (ws://localhost:8081/expo-dev-plugins/broadcast)
      ▼
Metro Dev Server (Standard Expo Bundler)
      │
      │ Existing DevTools Plugin channel (ws:// or wss:// via tunnel)
      ▼
<AgentBridge /> (in running mobile app)
      │
      ├─ react-native-view-shot (native screenshot capture)
      ├─ ErrorUtils & console hook (live error streaming)
      └─ Element Registry (tap, scroll, type dispatch)
```

- **No second tunnel**: Piggybacks on Metro's existing WebSocket broadcast channel.
- **No ATS overrides**: Tunnel mode uses `wss://` (secure TLS) automatically.
- **Works in WSL**: Connects over the single existing Expo tunnel.

---

## 📄 License

MIT © Fs02

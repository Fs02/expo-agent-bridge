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

### 1. Install in your Expo project

```bash
# Using npm
npm install expo-agent-bridge react-native-view-shot

# Using yarn
yarn add expo-agent-bridge react-native-view-shot
```

For a local sibling checkout of this repository, install the bridge explicitly
from that checkout:

```bash
yarn add expo-agent-bridge@file:../expo-agent-bridge react-native-view-shot
```

This local-file setup is for development only. Do not leave a `file:../…`
bridge dependency in an EAS or other remote production build: the sibling
checkout is not part of the build upload. Use a published package there, or
remove the bridge from the release dependency graph and resolve it only in
local development.

### 2. Initialize Agent Config & Skills

Run in your project root:

```bash
npx expo-agent-bridge init
```

The default Antigravity profile generates:
- `.agents/mcp_config.json` (MCP server configuration)
- `.agents/skills/expo-agent-bridge/SKILL.md` (MCP-first instructions with CLI fallback)

Choose another supported agent profile when needed:

```bash
npx expo-agent-bridge init --agent claude-code
npx expo-agent-bridge init --agent cursor
npx expo-agent-bridge init --agent windsurf
```

If multiple Expo/Metro servers are running, assign each project its own port
and pass it during initialization:

```bash
npx expo-agent-bridge init --metro-port 8082
```

Start that app on the same port, for example `npx expo start --port 8082`.

For direct CLI commands, pass the same port with `--metro-port <port>` (or `--port <port>`). The option may appear anywhere after the command:

```bash
npx expo-agent-bridge screenshot /tmp/screen.png --metro-port 8082
npx expo-agent-bridge navigate /settings --metro-port=8082
```

The generated MCP configuration pins the bridge to that project’s port.

Each profile writes its MCP configuration and skill to that agent's project directory.
For an unsupported or custom agent, specify the skill location directly:

```bash
npx expo-agent-bridge init \
  --skills-dir .my-agent/skills
```

Existing bridge skills are left untouched; pass `--force` to replace one.

MCP is enabled by default, but the generated skill falls back to the direct CLI
when an MCP call is unavailable or cannot reach the running app. To configure a
CLI-only project, use `npx expo-agent-bridge init --no-mcp`.

### 3. Mount in your Root Layout

In your root layout (e.g. `app/_layout.tsx` or `App.tsx`), load the component
only in development:

```tsx
import React from 'react';

// Keeps the bridge component out of the production module graph.
const DevAgentBridge = __DEV__
  ? (require('expo-agent-bridge').AgentBridge as React.ComponentType)
  : null;

export default function RootLayout() {
  return (
    <>
      {__DEV__ && DevAgentBridge ? <DevAgentBridge /> : null}
      {/* Rest of your app */}
    </>
  );
}
```

The package still has to be resolvable when Metro builds a development bundle.
For remote release builds, either use a published package or configure Metro
to map `expo-agent-bridge` to a local no-op module, as the app's release setup
requires.

### 4. Run Expo

```bash
npx expo start
# Or on WSL:
npx expo start --tunnel
```

Scan the QR code with your iPhone/Android device. Your AI agent can now immediately inspect and control the app!

---

## 🛠️ Bridge Commands

| Command | Description |
|---|---|
| `screenshot [file]` | Captures current mobile screen as PNG |
| `logs` | Streams recent errors, warnings, and exceptions |
| `reload` | Reloads the app bundle on device |
| `route` | Returns the active route |
| `elements` | Lists mounted interactive elements |
| `state` | Inspects exposed custom state |
| `reset-storage` | Clears AsyncStorage |
| `dev-menu` | Opens the developer menu |
| `navigate <route>` | Navigates to an Expo Router route |
| `tap <testID>` | Taps an element by test ID |
| `scroll <up\|down> [amount]` | Scrolls the active view |
| `type-text <testID> <text>` | Types text into a TextInput |

## 🖥️ Direct CLI Commands

The bridge can also be used directly from a shell without creating a temporary
JavaScript client:

```bash
npx expo-agent-bridge screenshot /tmp/screen.png
npx expo-agent-bridge logs
npx expo-agent-bridge route
npx expo-agent-bridge navigate /settings
npx expo-agent-bridge tap settings-button
npx expo-agent-bridge scroll down 300
npx expo-agent-bridge type-text search-input "Mecca"
```

These commands are the supported fallback for the MCP tools. They use the same
live app connection and do not require temporary JavaScript files.

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
npx --no-install expo-agent-bridge mcp
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

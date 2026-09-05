---
name: expo-agent-bridge
description: >-
  Use when doing UI/UX work on Expo & React Native apps. Teaches how to use the agent
  dev bridge to see live mobile screens, stream console logs & errors, and interact over Wi-Fi or
  WSL+--tunnel — screenshot, logs, reload, navigate, tap, scroll — no cables.
---

# Expo Agent Dev Bridge

Live visual feedback and interactive UI loop for React Native & Expo apps.
Uses Expo's DevTools Plugin broadcast channel — zero native cables, zero extra tunnels, works over WSL.

## Server Ownership

Assume the developer already started Expo/Metro and has the dev app open. Attach to that existing
server first; do **not** run `expo start`, restart Metro, or create a second dev server unless the
developer explicitly asks. If the bridge cannot connect, report the connection failure and ask the
developer to start or expose the server.

## Transport fallback

Use the MCP tools when they are available. If an MCP call is unavailable, times
out, or cannot reach the Expo server, immediately use the equivalent direct CLI
command below. Do not create a temporary JavaScript client. Both transports use
the same `expo-agent-bridge` protocol and control the same running app.

## Direct CLI Commands

For one-off shell actions, use the installed CLI instead of creating a temporary
JavaScript client:

```bash
npx --no-install expo-agent-bridge screenshot /tmp/screen.png
npx --no-install expo-agent-bridge logs
npx --no-install expo-agent-bridge navigate /settings
npx --no-install expo-agent-bridge scroll down 300
```

If multiple Expo apps are running, each app must use a distinct Metro port. For
example, initialize this project with `npx --no-install expo-agent-bridge init
--metro-port 8082` and start Expo with `npx expo start --port 8082`.

| CLI command | Description |
|---|---|
| `screenshot [file]` | Captures the current mobile screen as a PNG |
| `logs` | Streams recent errors, warnings, and exceptions |
| `reload` | Reloads the app bundle on the device |
| `route` | Returns the current route |
| `elements` | Lists mounted interactive elements |
| `state` | Inspects custom app state |
| `reset-storage` | Clears AsyncStorage |
| `dev-menu` | Opens the developer menu |
| `navigate <route>` | Navigates to an Expo Router route |
| `tap <testID>` | Presses an element by test ID |
| `scroll <up\|down> [amount]` | Scrolls the active view |
| `type-text <testID> <text>` | Types into a TextInput |

## Standard Agentic UI/UX Loop

1. `get_screenshot()` — observe current screen
2. Edit code
3. Wait 3s for Fast Refresh (or call `reload()` if stuck)
4. `get_screenshot()` — verify visual changes
5. Iterate or commit

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

## Available Tools

| Tool | Description |
|---|---|
| `get_screenshot()` | Captures current mobile screen as PNG — primary visual feedback |
| `get_logs(level?, limit?)` | Streams recent `console.error`, `console.warn`, and unhandled JS exceptions |
| `reload()` | Reloads app bundle on device (Metro broadcast + DevSettings.reload) |
| `get_route()` | Returns current active route, pathname, and segments from Expo Router |
| `get_elements()` | Lists currently mounted interactive UI elements (testIDs, titles, types) |
| `get_state()` | Inspects custom app state or stores exposed to bridge |
| `reset_storage()` | Clears AsyncStorage to test clean first-time install experience |
| `open_dev_menu()` | Opens developer menu on device without shaking |
| `navigate(route)` | Pushes an Expo Router route |
| `tap(target)` | Presses a component by its `testID` prop |
| `scroll(direction, amount?)` | Scrolls active scroll view up or down |
| `type_text(target, text)` | Types into a TextInput by its `testID` prop |

## Standard Agentic UI/UX Loop

1. `get_screenshot()` — observe current screen
2. Edit code
3. Wait 3s for Fast Refresh (or call `reload()` if stuck)
4. `get_screenshot()` — verify visual changes
5. Iterate or commit

import fs from 'fs';
import path from 'path';
import { startAgentBridgeMcpServer } from './server';

const args = process.argv.slice(2);
const command = args[0] || 'mcp';

if (command === 'init') {
  runInit();
} else if (command === 'mcp' || command === 'start') {
  startAgentBridgeMcpServer();
} else {
  console.log(`
expo-agent-bridge CLI

Commands:
  mcp      Start the MCP stdio server (default)
  init     Set up .agents/mcp_config.json and .agents/skills in the current project
`);
}

function runInit() {
  const cwd = process.cwd();
  console.log('[expo-agent-bridge] Initializing agent bridge in:', cwd);

  // 1. Create .agents/mcp_config.json
  const agentsDir = path.join(cwd, '.agents');
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }

  const mcpConfigFile = path.join(agentsDir, 'mcp_config.json');
  let config: any = { mcpServers: {} };
  if (fs.existsSync(mcpConfigFile)) {
    try {
      config = JSON.parse(fs.readFileSync(mcpConfigFile, 'utf8'));
    } catch {}
  }
  config.mcpServers = config.mcpServers || {};
  config.mcpServers['expo-agent-bridge'] = {
    command: 'npx',
    args: ['expo-agent-bridge', 'mcp'],
  };
  fs.writeFileSync(mcpConfigFile, JSON.stringify(config, null, 2) + '\n');
  console.log('✓ Configured .agents/mcp_config.json');

  // 2. Create .agents/skills/expo-agent-bridge/SKILL.md
  const skillDir = path.join(agentsDir, 'skills', 'expo-agent-bridge');
  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
  }

  const skillPath = path.join(skillDir, 'SKILL.md');
  const templatePath = path.join(__dirname, '..', 'skills', 'expo-agent-bridge', 'SKILL.md');

  let skillContent = '';
  if (fs.existsSync(templatePath)) {
    skillContent = fs.readFileSync(templatePath, 'utf8');
  } else {
    skillContent = defaultSkillContent();
  }

  fs.writeFileSync(skillPath, skillContent);
  console.log('✓ Generated .agents/skills/expo-agent-bridge/SKILL.md');

  console.log(`
Success! expo-agent-bridge is configured for this project.

Next steps:
1. In your root layout (e.g. app/_layout.tsx), mount <AgentBridge />:
   import { AgentBridge } from 'expo-agent-bridge';
   // Inside root component:
   <AgentBridge />

2. Run 'npx expo start' (or 'npx expo start --tunnel' on WSL)
3. Open the dev app on your phone.
4. Your AI agent can now take screenshots, inspect logs, and navigate!
`);
}

function defaultSkillContent(): string {
  return `---
name: expo-agent-bridge
description: >-
  Use when doing UI/UX work on Expo & React Native apps. Teaches how to use the agent
  dev bridge to see live mobile screens, stream console logs & errors, and interact over Wi-Fi or
  WSL+--tunnel — screenshot, logs, reload, navigate, tap, scroll — no cables.
---

# Expo Agent Dev Bridge

Live visual feedback and interactive UI loop for React Native & Expo apps.

## Available Tools

| Tool | Description |
|---|---|
| \`get_screenshot()\` | Captures current mobile screen as PNG — primary visual feedback |
| \`get_logs(level?, limit?)\` | Streams recent \`console.error\`, \`console.warn\`, and unhandled JS exceptions |
| \`reload()\` | Reloads app bundle on device (Metro broadcast + DevSettings.reload) |
| \`get_route()\` | Returns current active route, pathname, and segments from Expo Router |
| \`get_elements()\` | Lists currently mounted interactive UI elements (testIDs, titles, types) |
| \`get_state()\` | Inspects custom app state or stores exposed to bridge |
| \`reset_storage()\` | Clears AsyncStorage to test clean first-time install experience |
| \`open_dev_menu()\` | Opens developer menu on device without shaking |
| \`navigate(route)\` | Pushes an Expo Router route |
| \`tap(target)\` | Presses a component by its \`testID\` prop |
| \`scroll(direction, amount?)\` | Scrolls active scroll view up or down |
| \`type_text(target, text)\` | Types into a TextInput by its \`testID\` prop |

## Standard Agentic UI/UX Loop

1. \`get_screenshot()\` — observe current screen
2. Edit code
3. Wait 3s for Fast Refresh (or call \`reload()\` if stuck)
4. \`get_screenshot()\` — verify visual changes
5. Iterate or commit
`;
}

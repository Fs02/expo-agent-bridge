import fs from 'fs';
import path from 'path';
import { startAgentBridgeMcpServer } from './server';
import { sendBridgeCommand, writeScreenshot } from './client';

type Json = Record<string, unknown>;
export type AgentProfileName = 'antigravity' | 'claude-code' | 'cursor' | 'windsurf';

export interface AgentProfile {
  name: AgentProfileName;
  mcpConfigPath: string;
  skillDirectory: string;
}

const AGENT_PROFILES: Record<AgentProfileName, AgentProfile> = {
  antigravity: { name: 'antigravity', mcpConfigPath: '.agents/mcp_config.json', skillDirectory: '.agents/skills' },
  'claude-code': { name: 'claude-code', mcpConfigPath: '.mcp.json', skillDirectory: '.claude/skills' },
  cursor: { name: 'cursor', mcpConfigPath: '.cursor/mcp.json', skillDirectory: '.cursor/skills' },
  windsurf: { name: 'windsurf', mcpConfigPath: '.windsurf/mcp_config.json', skillDirectory: '.windsurf/skills' },
};

export type InitOptions = {
  agent: AgentProfileName;
  skillDirectory?: string;
  mcpConfigPath?: string;
  metroPort?: number;
  mcp: boolean;
  force: boolean;
};

export function runCli(args: string[], cwd = process.cwd()): void | Promise<void> {
  const command = args[0] || 'mcp';
  if (command === 'init') {
    const initArgs = args.slice(1);
    if (initArgs.includes('--help') || initArgs.includes('-h')) printHelp();
    else runInit(cwd, parseInitOptions(initArgs));
  }
  else if (command === 'mcp' || command === 'start') startAgentBridgeMcpServer({ metroPort: parseMetroPort(args.slice(1)) });
  else if (DIRECT_COMMANDS.has(command)) return runDirectCommand(command, args.slice(1), cwd);
  else printHelp();
}

const DIRECT_COMMANDS = new Set(['screenshot', 'logs', 'reload', 'route', 'elements', 'state', 'reset-storage', 'dev-menu', 'navigate', 'tap', 'scroll', 'type-text']);

export async function runDirectCommand(command: string, args: string[], cwd: string): Promise<void> {
  try {
    const { positional, metroPort } = extractMetroPort(args);
    const clientOptions = { metroPort };
    if (command === 'screenshot') {
      const output = path.resolve(cwd, positional[0] ?? 'expo-agent-screenshot.png');
      writeScreenshot(await sendBridgeCommand('screenshot', {}, clientOptions), output);
      console.log(output);
      return;
    }
    if (command === 'reload') { await sendBridgeCommand('reload', {}, clientOptions); console.log('App reload triggered.'); return; }
    if (command === 'dev-menu') { await sendBridgeCommand('open_dev_menu', {}, clientOptions); console.log('Developer menu triggered.'); return; }
    if (command === 'navigate') { const route = requiredArg(command, positional, 0); await sendBridgeCommand('navigate', { route }, clientOptions); console.log(`Navigated to ${route}`); return; }
    if (command === 'tap') { const target = requiredArg(command, positional, 0); await sendBridgeCommand('tap', { target }, clientOptions); console.log(`Tapped ${target}`); return; }
    if (command === 'type-text') { const target = requiredArg(command, positional, 0); const text = requiredArg(command, positional, 1); await sendBridgeCommand('type', { target, text }, clientOptions); console.log(`Typed into ${target}`); return; }
    if (command === 'scroll') { const direction = requiredArg(command, positional, 0); const amount = Number(positional[1] ?? 300); await sendBridgeCommand('scroll', { direction, amount }, clientOptions); console.log(`Scrolled ${direction} ${amount}px`); return; }
    if (command === 'reset-storage') { await sendBridgeCommand('reset_storage', {}, clientOptions); console.log('AsyncStorage cleared.'); return; }
    const action = command === 'logs' ? 'get_logs' : command === 'route' ? 'get_route' : command === 'elements' ? 'get_elements' : 'get_state';
    const result = await sendBridgeCommand(action, {}, clientOptions);
    const key = action === 'get_route' ? 'route' : action === 'get_elements' ? 'elements' : action === 'get_state' ? 'state' : 'logs';
    console.log(JSON.stringify(result[key] ?? result, null, 2));
  } catch (error: any) {
    process.stderr.write(`[expo-agent-bridge] ${error.message}\n`);
    process.exitCode = 1;
  }
}

function requiredArg(command: string, args: string[], index: number): string {
  if (!args[index]) throw new Error(`${command} requires argument ${index + 1}.`);
  return args[index];
}

export function parseInitOptions(args: string[]): InitOptions {
  const options: InitOptions = { agent: 'antigravity', force: false, mcp: true };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const next = () => {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
      return value;
    };
    if (argument === '--agent') options.agent = validateAgent(next());
    else if (argument.startsWith('--agent=')) options.agent = validateAgent(argument.slice('--agent='.length));
    else if (argument === '--skills-dir') options.skillDirectory = next();
    else if (argument.startsWith('--skills-dir=')) options.skillDirectory = argument.slice('--skills-dir='.length);
    else if (argument === '--mcp-config') options.mcpConfigPath = next();
    else if (argument.startsWith('--mcp-config=')) options.mcpConfigPath = argument.slice('--mcp-config='.length);
    else if (argument === '--metro-port') options.metroPort = parsePort(next());
    else if (argument.startsWith('--metro-port=')) options.metroPort = parsePort(argument.slice('--metro-port='.length));
    else if (argument === '--no-mcp') options.mcp = false;
    else if (argument === '--force') options.force = true;
    else throw new Error(`Unknown init option: ${argument}`);
  }
  return options;
}

function validateAgent(agent: string): AgentProfileName {
  if (agent in AGENT_PROFILES) return agent as AgentProfileName;
  throw new Error(`Unsupported agent "${agent}". Choose one of: ${Object.keys(AGENT_PROFILES).join(', ')}.`);
}

export function runInit(cwd: string, options: InitOptions): void {
  const profile = AGENT_PROFILES[options.agent];
  const mcpConfigPath = resolveProjectPath(cwd, options.mcpConfigPath ?? profile.mcpConfigPath, '--mcp-config');
  const skillDirectory = resolveProjectPath(cwd, options.skillDirectory ?? profile.skillDirectory, '--skills-dir');
  console.log(`[expo-agent-bridge] Initializing for ${profile.name} in: ${cwd}`);

  const config = readJsonObject(mcpConfigPath);
  const mcpServers = isObject(config.mcpServers) ? config.mcpServers : {};
  delete mcpServers['kuso-agent-bridge'];
  delete mcpServers['khusoo-dev-bridge'];
  if (options.mcp) {
    const bridgeServer: Json = {
      command: 'npx',
      args: ['--no-install', 'expo-agent-bridge', 'mcp'],
    };
    if (options.metroPort) bridgeServer.env = { EXPO_METRO_PORT: String(options.metroPort) };
    mcpServers['expo-agent-bridge'] = bridgeServer;
  } else {
    delete mcpServers['expo-agent-bridge'];
  }
  if (Object.keys(mcpServers).length > 0) {
    config.mcpServers = mcpServers;
    writeFile(mcpConfigPath, JSON.stringify(config, null, 2) + '\n');
  } else if (fs.existsSync(mcpConfigPath)) {
    fs.unlinkSync(mcpConfigPath);
  }
  console.log(`✓ ${options.mcp ? 'Configured' : 'Removed'} MCP bridge in ${displayProjectPath(cwd, mcpConfigPath)}`);

  const skillPath = path.join(skillDirectory, 'expo-agent-bridge', 'SKILL.md');
  if (fs.existsSync(skillPath) && !options.force) {
    console.log(`• Kept existing ${displayProjectPath(cwd, skillPath)} (use --force to replace it)`);
  } else {
    writeFile(skillPath, loadSkillTemplate());
    console.log(`✓ Generated ${displayProjectPath(cwd, skillPath)}`);
  }

  console.log(`\nSuccess! expo-agent-bridge is configured for ${profile.name}.\n\nNext steps:\n1. Mount <AgentBridge /> only behind a __DEV__ lazy require in your root layout.\n2. If Expo is not already running, start it with 'npx expo start' (or '--tunnel' on WSL).\n3. Open the dev app on your phone or simulator.\n4. Try MCP first; if it is unavailable, use 'npx --no-install expo-agent-bridge screenshot /tmp/screen.png' or another direct CLI command.\n`);
}

function resolveProjectPath(cwd: string, input: string, flag: string): string {
  const resolved = path.resolve(cwd, input);
  const relative = path.relative(cwd, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${flag} must stay inside the project directory.`);
  }
  return resolved;
}

function readJsonObject(file: string): Json {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isObject(parsed)) throw new Error('Expected a JSON object.');
    return parsed;
  } catch (error: any) {
    throw new Error(`Could not read ${file}: ${error.message}`);
  }
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function displayProjectPath(cwd: string, file: string): string {
  return path.relative(cwd, file) || path.basename(file);
}

export function extractMetroPort(args: string[]): { positional: string[]; metroPort?: number } {
  const positional: string[] = [];
  let metroPort: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const isSeparateFlag = argument === '--metro-port' || argument === '--port';
    const isEqualsFlag = argument.startsWith('--metro-port=') || argument.startsWith('--port=');
    if (!isSeparateFlag && !isEqualsFlag) {
      positional.push(argument);
      continue;
    }
    if (metroPort !== undefined) throw new Error('Specify Metro port only once.');
    const value = isSeparateFlag ? args[++index] : argument.slice(argument.indexOf('=') + 1);
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
    metroPort = parsePort(value);
  }
  return { positional, metroPort };
}

function parseMetroPort(args: string[]): number | undefined {
  return extractMetroPort(args).metroPort;
}

function parsePort(value: string | undefined): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid Metro port "${value}". Use a number from 1 to 65535.`);
  return port;
}

function loadSkillTemplate(): string {
  const templatePath = path.join(__dirname, '..', 'skills', 'expo-agent-bridge', 'SKILL.md');
  return fs.existsSync(templatePath) ? fs.readFileSync(templatePath, 'utf8') : defaultSkillContent();
}

function printHelp(): void {
  console.log(`\nexpo-agent-bridge CLI\n\nCommands:\n  mcp [--metro-port <port>]  Start the MCP stdio server (default port: 8081)\n  init     Configure MCP plus CLI fallback and the agent skill\n  screenshot [file]  Save a screenshot\n  logs | route | elements | state\n  reload | reset-storage | dev-menu\n  navigate <route> | tap <testID> | scroll <up|down> [amount]\n  type-text <testID> <text>\n\nDirect command options (accepted after the command in any position):\n  --metro-port <port>  Metro port for this app (alias: --port)\n\nInit options:\n  --agent <name>       antigravity (default), claude-code, cursor, or windsurf\n  --skills-dir <path>  Override the profile's skill directory\n  --mcp-config <path>  Override the profile's MCP configuration file\n  --metro-port <port>  Metro port for this app (use a unique port per app)\n  --no-mcp             Configure CLI only\n  --force              Replace an existing bridge SKILL.md\n\nExamples:\n  npx expo-agent-bridge screenshot /tmp/screen.png --metro-port 8082\n  npx expo-agent-bridge navigate /settings --metro-port=8082\n  npx expo-agent-bridge init --metro-port 8082\n`);
}

function defaultSkillContent(): string {
  return `---\nname: expo-agent-bridge\ndescription: Expo and React Native visual feedback and interaction bridge.\n---\n\n# Expo Agent Dev Bridge\n\nLive visual feedback and interactive UI loop for React Native & Expo apps.\n\n## Server Ownership\n\nAttach to an existing Expo/Metro server by default. Do not start or restart the server unless the developer explicitly asks.\n`;
}

if (require.main === module) {
  try {
    runCli(process.argv.slice(2));
  } catch (error: any) {
    process.stderr.write(`[expo-agent-bridge] ${error.message}\n`);
    process.exitCode = 1;
  }
}

import fs from 'fs';
import path from 'path';
import { startAgentBridgeMcpServer } from './server';

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
  force: boolean;
};

export function runCli(args: string[], cwd = process.cwd()): void {
  const command = args[0] || 'mcp';
  if (command === 'init') {
    const initArgs = args.slice(1);
    if (initArgs.includes('--help') || initArgs.includes('-h')) printHelp();
    else runInit(cwd, parseInitOptions(initArgs));
  }
  else if (command === 'mcp' || command === 'start') startAgentBridgeMcpServer();
  else printHelp();
}

export function parseInitOptions(args: string[]): InitOptions {
  const options: InitOptions = { agent: 'antigravity', force: false };
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
  mcpServers['expo-agent-bridge'] = { command: 'npx', args: ['expo-agent-bridge', 'mcp'] };
  config.mcpServers = mcpServers;
  writeFile(mcpConfigPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`✓ Configured ${displayProjectPath(cwd, mcpConfigPath)}`);

  const skillPath = path.join(skillDirectory, 'expo-agent-bridge', 'SKILL.md');
  if (fs.existsSync(skillPath) && !options.force) {
    console.log(`• Kept existing ${displayProjectPath(cwd, skillPath)} (use --force to replace it)`);
  } else {
    writeFile(skillPath, loadSkillTemplate());
    console.log(`✓ Generated ${displayProjectPath(cwd, skillPath)}`);
  }

  console.log(`\nSuccess! expo-agent-bridge is configured for ${profile.name}.\n\nNext steps:\n1. Mount <AgentBridge /> in your root layout.\n2. If Expo is not already running, start it with 'npx expo start' (or '--tunnel' on WSL).\n3. Open the dev app on your phone or simulator.\n4. Your AI agent can now take screenshots, inspect logs, and navigate!\n`);
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

function loadSkillTemplate(): string {
  const templatePath = path.join(__dirname, '..', 'skills', 'expo-agent-bridge', 'SKILL.md');
  return fs.existsSync(templatePath) ? fs.readFileSync(templatePath, 'utf8') : defaultSkillContent();
}

function printHelp(): void {
  console.log(`\nexpo-agent-bridge CLI\n\nCommands:\n  mcp      Start the MCP stdio server (default)\n  init     Configure an MCP server and agent skill in the current project\n\nInit options:\n  --agent <name>       antigravity (default), claude-code, cursor, or windsurf\n  --skills-dir <path>  Override the profile's skill directory\n  --mcp-config <path>  Override the profile's MCP configuration file\n  --force              Replace an existing bridge SKILL.md\n\nExamples:\n  npx expo-agent-bridge init --agent claude-code\n  npx expo-agent-bridge init --skills-dir .agents/skills\n`);
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

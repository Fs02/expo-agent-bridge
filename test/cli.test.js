const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { extractMetroPort, parseInitOptions, runCli, runInit } = require('../dist/cli.js');
const client = require('../dist/client.js');

function withProject(callback) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-agent-bridge-'));
  try {
    callback(project);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}

async function withAsyncProject(callback) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-agent-bridge-'));
  try {
    await callback(project);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}

test('init configures MCP and uses the Antigravity profile by default', () => {
  withProject((project) => {
    const configPath = path.join(project, '.agents', 'mcp_config.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { existing: { command: 'existing' } } }));

    runInit(project, parseInitOptions([]));

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.deepEqual(config.mcpServers.existing, { command: 'existing' });
    assert.deepEqual(config.mcpServers['expo-agent-bridge'], {
      command: 'npx',
      args: ['--no-install', 'expo-agent-bridge', 'mcp'],
    });
    const skillPath = path.join(project, '.agents', 'skills', 'expo-agent-bridge', 'SKILL.md');
    assert.match(fs.readFileSync(skillPath, 'utf8'), /Attach to that existing[\s\S]*do \*\*not\*\* run `expo start`/);
  });
});

test('init writes the selected Cursor MCP and skill configuration', () => {
  withProject((project) => {
    runInit(project, parseInitOptions(['--agent', 'cursor']));

    assert.ok(fs.existsSync(path.join(project, '.cursor', 'mcp.json')));
    assert.ok(fs.existsSync(path.join(project, '.cursor', 'skills', 'expo-agent-bridge', 'SKILL.md')));
  });
});

test('init pins MCP to a project-specific Metro port and supports CLI-only mode', () => {
  withProject((project) => {
    runInit(project, parseInitOptions(['--metro-port', '8082']));
    const configPath = path.join(project, '.agents', 'mcp_config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.deepEqual(config.mcpServers['expo-agent-bridge'].env, { EXPO_METRO_PORT: '8082' });
    assert.ok(fs.existsSync(path.join(project, '.agents', 'skills', 'expo-agent-bridge', 'SKILL.md')));

    runInit(project, parseInitOptions(['--no-mcp', '--force']));
    assert.equal(fs.existsSync(configPath), false);
  });
});

test('custom skill directories work and existing skills are preserved without --force', () => {
  withProject((project) => {
    const skill = path.join(project, '.config', 'skills', 'expo-agent-bridge', 'SKILL.md');
    fs.mkdirSync(path.dirname(skill), { recursive: true });
    fs.writeFileSync(skill, 'custom instructions\n');

    runInit(project, parseInitOptions(['--skills-dir', '.config/skills']));
    assert.equal(fs.readFileSync(skill, 'utf8'), 'custom instructions\n');

    runInit(project, parseInitOptions(['--skills-dir=.config/skills', '--force']));
    assert.notEqual(fs.readFileSync(skill, 'utf8'), 'custom instructions\n');
  });
});

test('init rejects unknown agents and configuration paths outside the project', () => {
  assert.throws(() => parseInitOptions(['--agent', 'unknown']), /Unsupported agent/);
  withProject((project) => {
    assert.throws(
      () => runInit(project, parseInitOptions(['--skills-dir', '../outside'])),
      /must stay inside the project/
    );
  });
});

test('direct CLI commands pass an explicit Metro port without consuming positional arguments', async () => {
  const originalSendBridgeCommand = client.sendBridgeCommand;
  const originalWriteScreenshot = client.writeScreenshot;
  const calls = [];
  const screenshots = [];
  client.sendBridgeCommand = async (action, params, options) => {
    calls.push({ action, params, options });
    return { logs: [], route: '/settings', elements: [], state: {} };
  };
  client.writeScreenshot = (response, output) => screenshots.push({ response, output });

  try {
    await withAsyncProject(async (project) => {
      const cases = [
        ['screenshot', ['screen.png', '--metro-port', '8083'], 'screenshot', {}],
        ['logs', ['--port=8083'], 'get_logs', {}],
        ['reload', ['--metro-port=8083'], 'reload', {}],
        ['route', ['--port', '8083'], 'get_route', {}],
        ['elements', ['--metro-port', '8083'], 'get_elements', {}],
        ['state', ['--port=8083'], 'get_state', {}],
        ['reset-storage', ['--metro-port=8083'], 'reset_storage', {}],
        ['dev-menu', ['--port', '8083'], 'open_dev_menu', {}],
        ['navigate', ['--metro-port=8083', '/settings'], 'navigate', { route: '/settings' }],
        ['tap', ['save-button', '--port', '8083'], 'tap', { target: 'save-button' }],
        ['scroll', ['down', '--metro-port=8083', '450'], 'scroll', { direction: 'down', amount: 450 }],
        ['type-text', ['email', '--port=8083', 'me@example.com'], 'type', { target: 'email', text: 'me@example.com' }],
      ];

      for (const [command, args, action, params] of cases) {
        await runCli([command, ...args], project);
        assert.deepEqual(calls.pop(), { action, params, options: { metroPort: 8083 } });
      }
      assert.deepEqual(screenshots, [{
        response: { logs: [], route: '/settings', elements: [], state: {} },
        output: path.join(project, 'screen.png'),
      }]);
    });
  } finally {
    client.sendBridgeCommand = originalSendBridgeCommand;
    client.writeScreenshot = originalWriteScreenshot;
  }
});

test('direct Metro port parsing rejects malformed and ambiguous options before connecting', async () => {
  assert.deepEqual(extractMetroPort(['screen.png', '--metro-port=8083']), {
    positional: ['screen.png'],
    metroPort: 8083,
  });
  assert.throws(() => extractMetroPort(['--metro-port']), /requires a value/);
  assert.throws(() => extractMetroPort(['--port=not-a-port']), /Invalid Metro port/);
  assert.throws(() => extractMetroPort(['--metro-port', '8083', '--port=8084']), /only once/);

  const originalSendBridgeCommand = client.sendBridgeCommand;
  const originalStderrWrite = process.stderr.write;
  const originalExitCode = process.exitCode;
  let calls = 0;
  let stderr = '';
  client.sendBridgeCommand = async () => { calls += 1; return {}; };
  process.stderr.write = (chunk) => { stderr += chunk; return true; };
  process.exitCode = undefined;

  try {
    await withAsyncProject((project) => runCli(['screenshot', 'screen.png', '--metro-port', 'not-a-port'], project));
    assert.equal(calls, 0);
    assert.match(stderr, /Invalid Metro port/);
  } finally {
    client.sendBridgeCommand = originalSendBridgeCommand;
    process.stderr.write = originalStderrWrite;
    process.exitCode = originalExitCode;
  }
});

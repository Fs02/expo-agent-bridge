const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { parseInitOptions, runInit } = require('../dist/cli.js');

function withProject(callback) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-agent-bridge-'));
  try {
    callback(project);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}

test('init keeps existing MCP servers and uses the Antigravity profile by default', () => {
  withProject((project) => {
    const configPath = path.join(project, '.agents', 'mcp_config.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { existing: { command: 'existing' } } }));

    runInit(project, parseInitOptions([]));

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.deepEqual(config.mcpServers.existing, { command: 'existing' });
    assert.deepEqual(config.mcpServers['expo-agent-bridge'], {
      command: 'npx',
      args: ['expo-agent-bridge', 'mcp'],
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

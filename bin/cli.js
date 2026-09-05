#!/usr/bin/env node
const { runCli } = require('../dist/cli.js');

try {
  runCli(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`[expo-agent-bridge] ${error.message}\n`);
  process.exitCode = 1;
}

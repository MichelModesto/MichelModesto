#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const installHome = process.env.CODE_HOUSE_INSTALL_HOME || os.homedir();
const sourceHook = path.join(here, 'code-house-codex-hook.sh');
const installDir = path.join(installHome, '.local', 'share', 'michel-code-house');
const installedHook = path.join(installDir, 'codex-hook.sh');
const codexDir = path.join(installHome, '.codex');
const configPath = path.join(codexDir, 'hooks.json');

const events = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'SessionEnd',
];

fs.mkdirSync(installDir, { recursive: true });
fs.mkdirSync(codexDir, { recursive: true });
fs.copyFileSync(sourceHook, installedHook);
fs.chmodSync(installedHook, 0o755);

let config = { hooks: {} };
if (fs.existsSync(configPath)) {
  const original = fs.readFileSync(configPath, 'utf8');
  config = JSON.parse(original);
  const stamp = new Date().toISOString().replaceAll(':', '-');
  fs.writeFileSync(`${configPath}.bak-code-house-${stamp}`, original);
}

config.hooks ??= {};
const command = `/bin/sh '${installedHook}'`;

for (const event of events) {
  config.hooks[event] ??= [];
  const alreadyInstalled = config.hooks[event].some((matcher) =>
    matcher?.hooks?.some((hook) => hook?.command === command),
  );
  if (!alreadyInstalled) {
    config.hooks[event].push({
      hooks: [{ type: 'command', command, timeout: 2 }],
    });
  }
}

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log('Hooks do Michel Code House instalados sem remover os hooks existentes.');
console.log(`Configuração: ${configPath}`);
console.log(`Encaminhador: ${installedHook}`);
console.log('Agora reinicie a sessão do Codex e aprove os novos hooks em /hooks.');

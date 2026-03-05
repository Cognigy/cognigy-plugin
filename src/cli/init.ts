/**
 * CLI init command — auto-configures MCP clients with the Cognigy MCP server.
 *
 * Usage:
 *   npx @cognigy/mcp-server init --client cursor
 *   npx @cognigy/mcp-server init --client claude
 *   npx @cognigy/mcp-server init --client claude-code
 *   npx @cognigy/mcp-server init --client vscode
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

const CLIENTS: Record<string, { name: string; configPath: () => string; wrapKey?: string }> = {
  cursor: {
    name: 'Cursor',
    configPath: () => {
      switch (process.platform) {
        case 'darwin':
          return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'mcp', 'mcp.json');
        case 'win32':
          return path.join(process.env.APPDATA || '', 'Cursor', 'User', 'globalStorage', 'mcp', 'mcp.json');
        default:
          return path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'mcp', 'mcp.json');
      }
    },
  },
  claude: {
    name: 'Claude Desktop',
    configPath: () => {
      switch (process.platform) {
        case 'darwin':
          return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
        case 'win32':
          return path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
        default:
          return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
      }
    },
  },
  'claude-code': {
    name: 'Claude Code',
    configPath: () => path.join(process.cwd(), '.mcp.json'),
  },
  vscode: {
    name: 'VS Code',
    configPath: () => path.join(process.cwd(), '.vscode', 'mcp.json'),
    wrapKey: 'servers',
  },
};

function prompt(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function generateServerBlock() {
  return {
    command: 'npx',
    args: ['-y', '@cognigy/mcp-server'],
    env: {
      COGNIGY_API_BASE_URL: '${COGNIGY_API_BASE_URL}',
      COGNIGY_API_KEY: '${COGNIGY_API_KEY}',
    },
  };
}

function mergeConfig(configPath: string, wrapKey?: string, apiBaseUrl?: string, apiKey?: string) {
  let config: any = {};

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      config = {};
    }
  }

  const serverBlock = generateServerBlock();
  if (apiBaseUrl) serverBlock.env.COGNIGY_API_BASE_URL = apiBaseUrl;
  if (apiKey) serverBlock.env.COGNIGY_API_KEY = apiKey;

  if (wrapKey) {
    config[wrapKey] = config[wrapKey] || {};
    config[wrapKey].cognigy = serverBlock;
  } else {
    config.mcpServers = config.mcpServers || {};
    config.mcpServers.cognigy = serverBlock;
  }

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

export async function runInit(args: string[]) {
  const clientIdx = args.indexOf('--client');
  const clientKey = clientIdx !== -1 ? args[clientIdx + 1] : undefined;

  console.log('');
  console.log('  Cognigy MCP Server — Setup');
  console.log('  ──────────────────────────');
  console.log('');

  if (!clientKey || !CLIENTS[clientKey]) {
    console.log('  Usage: npx @cognigy/mcp-server init --client <client>');
    console.log('');
    console.log('  Supported clients:');
    for (const [key, { name }] of Object.entries(CLIENTS)) {
      console.log(`    --client ${key.padEnd(14)} ${name}`);
    }
    console.log('');
    process.exit(1);
  }

  const client = CLIENTS[clientKey];
  const configPath = client.configPath();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const apiBaseUrl = await prompt(rl, 'Cognigy API URL', 'https://api-trial.cognigy.ai');

    let apiKey = '';
    while (!apiKey) {
      apiKey = await prompt(rl, 'Cognigy API Key');
      if (!apiKey) console.log('  API key is required.');
    }

    mergeConfig(configPath, client.wrapKey, apiBaseUrl, apiKey);

    console.log('');
    console.log(`  ✓ ${client.name} configured`);
    console.log(`    ${configPath}`);
    console.log('');
    console.log(`  Restart ${client.name} to load the Cognigy MCP server.`);
    console.log('');
  } finally {
    rl.close();
  }
}

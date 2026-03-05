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

interface ClientConfig {
  name: string;
  configPath: () => string;
  wrapKey?: string;
  gitignoreEntry?: string;
}

const CLIENTS: Record<string, ClientConfig> = {
  cursor: {
    name: 'Cursor',
    configPath: () => path.join(os.homedir(), '.cursor', 'mcp.json'),
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
    gitignoreEntry: '.mcp.json',
  },
  vscode: {
    name: 'VS Code',
    configPath: () => path.join(process.cwd(), '.vscode', 'mcp.json'),
    wrapKey: 'servers',
    gitignoreEntry: '.vscode/mcp.json',
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

function generateServerBlock(apiBaseUrl: string, apiKey: string) {
  return {
    command: 'npx',
    args: ['-y', '@cognigy/mcp-server'],
    env: {
      COGNIGY_API_BASE_URL: apiBaseUrl,
      COGNIGY_API_KEY: apiKey,
    },
  };
}

function mergeConfig(configPath: string, apiBaseUrl: string, apiKey: string, wrapKey?: string) {
  let config: any = {};

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8');
    try {
      config = JSON.parse(raw);
    } catch {
      throw new Error(
        `Could not parse ${configPath} as JSON. Please fix or remove the file and try again.`,
      );
    }
  }

  const serverBlock = generateServerBlock(apiBaseUrl, apiKey);

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
    if (client.gitignoreEntry) {
      console.log(`  Config will be written to: ${configPath}`);
      console.log(`  (project directory: ${process.cwd()})`);
      console.log('');
      const confirm = await prompt(rl, 'Is this the correct project directory?', 'Y');
      if (confirm.toLowerCase() !== 'y') {
        console.log('');
        console.log('  Run this command again from your project directory:');
        console.log(`    cd /path/to/your/project`);
        console.log(`    npx @cognigy/mcp-server init --client ${clientKey}`);
        console.log('');
        process.exit(0);
      }
    }

    const apiBaseUrl = await prompt(rl, 'Cognigy API URL', 'https://api-trial.cognigy.ai');

    let apiKey = '';
    while (!apiKey) {
      apiKey = await prompt(rl, 'Cognigy API Key');
      if (!apiKey) console.log('  API key is required.');
    }

    mergeConfig(configPath, apiBaseUrl, apiKey, client.wrapKey);

    console.log('');
    console.log(`  ✓ ${client.name} configured`);
    console.log(`    ${configPath}`);

    if (client.gitignoreEntry) {
      const gitignorePath = path.join(process.cwd(), '.gitignore');
      let alreadyIgnored = false;

      if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, 'utf-8');
        alreadyIgnored = content.split('\n').some(
          (line) => line.trim() === client.gitignoreEntry,
        );
      }

      if (!alreadyIgnored) {
        console.log('');
        console.log(`  ⚠ ${client.gitignoreEntry} contains your API key.`);
        const answer = await prompt(rl, `Add ${client.gitignoreEntry} to .gitignore?`, 'Y');
        if (answer.toLowerCase() === 'y') {
          const newline = fs.existsSync(gitignorePath) && !fs.readFileSync(gitignorePath, 'utf-8').endsWith('\n') ? '\n' : '';
          fs.appendFileSync(gitignorePath, `${newline}${client.gitignoreEntry}\n`);
          console.log(`  ✓ Added to .gitignore`);
        } else {
          console.log(`  → Remember to add ${client.gitignoreEntry} to .gitignore manually.`);
        }
      }
    }

    console.log('');
    console.log(`  Restart ${client.name} to load the Cognigy MCP server.`);
    console.log('');
  } finally {
    rl.close();
  }
}

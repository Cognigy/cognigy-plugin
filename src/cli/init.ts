/* eslint-disable no-useless-catch */
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

type AuthMode = 'api-key' | 'oauth';

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

async function promptAuthMode(rl: readline.Interface): Promise<AuthMode> {
  while (true) {
    const answer = (await prompt(rl, 'Authentication mode (oauth/api-key)', 'oauth')).toLowerCase();
    if (answer === 'oauth' || answer === 'api-key') {
      return answer;
    }
    console.log('  Please enter either "oauth" or "api-key".');
  }
}

function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(`  ${question}: `);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let input = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.removeListener('data', onData);
          stdin.setRawMode(wasRaw);
          stdin.pause();
          process.stdout.write('\n');
          resolve(input);
          return;
        } else if (ch === '\u0003') {
          process.exit(0);
        } else if (ch === '\u007F' || ch === '\b') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          input += ch;
          process.stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

function generateServerBlock(env: Record<string, string>) {
  return {
    command: 'npx',
    args: ['-y', '@cognigy/mcp-server'],
    env,
  };
}

function mergeConfig(configPath: string, env: Record<string, string>, wrapKey?: string) {
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

  const serverBlock = generateServerBlock(env);

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
  console.log('  ╔═══════════════════════════════════════════════╗');
  console.log('  ║                                               ║');
  console.log('  ║       C O G N I G Y   M C P   S E R V E R     ║');
  console.log('  ║              Installation Setup               ║');
  console.log('  ║                                               ║');
  console.log('  ╚═══════════════════════════════════════════════╝');
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
    const authMode = await promptAuthMode(rl);

    const env: Record<string, string> = {
      COGNIGY_API_BASE_URL: apiBaseUrl,
      COGNIGY_AUTH_MODE: authMode,
    };

    if (authMode === 'api-key') {
      rl.close();
      let apiKey = '';
      while (!apiKey) {
        apiKey = await promptSecret('Cognigy API Key');
        if (!apiKey) console.log('  API key is required.');
      }
      env.COGNIGY_API_KEY = apiKey;
    } else {
      const issuerBaseUrl = await prompt(rl, 'Cognigy OAuth issuer URL', apiBaseUrl);
      const clientId = await prompt(rl, 'Cognigy OAuth client ID', 'cognigy-mcp');
      const redirectUri = await prompt(
        rl,
        'Cognigy OAuth redirect URI',
        'http://127.0.0.1:8789/oauth/callback'
      );
      const scopes = await prompt(rl, 'Cognigy OAuth scopes', 'mcp:access');
      const organizationId = await prompt(rl, 'Cognigy organisation ID (optional)');
      rl.close();

      env.COGNIGY_OAUTH_ISSUER_BASE_URL = issuerBaseUrl;
      env.COGNIGY_OAUTH_CLIENT_ID = clientId;
      env.COGNIGY_OAUTH_REDIRECT_URI = redirectUri;
      env.COGNIGY_OAUTH_SCOPES = scopes;
      if (organizationId) {
        env.COGNIGY_ORGANISATION_ID = organizationId;
      }
    }

    mergeConfig(configPath, env, client.wrapKey);

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
        const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
        console.log('');
        console.log(`  ⚠ ${client.gitignoreEntry} contains your Cognigy MCP credentials.`);
        const answer = await prompt(rl2, `Add ${client.gitignoreEntry} to .gitignore?`, 'Y');
        rl2.close();
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
  } catch (error) {
    throw error;
  }
}

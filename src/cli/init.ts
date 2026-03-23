/**
 * CLI init command — auto-configures MCP clients with the Cognigy MCP server.
 *
 * Usage:
 *   npx @cognigy/mcp-server init --client cursor
 *   npx @cognigy/mcp-server init --client claude
 *   npx @cognigy/mcp-server init --client claude-code
 *   npx @cognigy/mcp-server init --client codex
 *   npx @cognigy/mcp-server init --client vscode
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

interface ClientConfig {
  name: string;
  configPath: () => string;
  wrapKey?: string;
  gitignoreEntry?: string;
  install?: (apiBaseUrl: string, apiKey: string) => void;
}

interface ServerLaunchConfig {
  command: string;
  args: string[];
}

const CLIENTS: Record<string, ClientConfig> = {
  cursor: {
    name: "Cursor",
    configPath: () => path.join(os.homedir(), ".cursor", "mcp.json"),
  },
  claude: {
    name: "Claude Desktop",
    configPath: () => {
      switch (process.platform) {
        case "darwin":
          return path.join(
            os.homedir(),
            "Library",
            "Application Support",
            "Claude",
            "claude_desktop_config.json",
          );
        case "win32":
          return path.join(
            process.env.APPDATA || "",
            "Claude",
            "claude_desktop_config.json",
          );
        default:
          return path.join(
            os.homedir(),
            ".config",
            "Claude",
            "claude_desktop_config.json",
          );
      }
    },
  },
  "claude-code": {
    name: "Claude Code",
    configPath: () => path.join(process.cwd(), ".mcp.json"),
    gitignoreEntry: ".mcp.json",
  },
  codex: {
    name: "Codex",
    configPath: () => path.join(os.homedir(), ".codex", "config.toml"),
    install: (apiBaseUrl: string, apiKey: string) =>
      mergeCodexConfig(
        path.join(os.homedir(), ".codex", "config.toml"),
        apiBaseUrl,
        apiKey,
      ),
  },
  vscode: {
    name: "VS Code",
    configPath: () => path.join(process.cwd(), ".vscode", "mcp.json"),
    wrapKey: "servers",
    gitignoreEntry: ".vscode/mcp.json",
  },
};

function prompt(
  rl: readline.Interface,
  question: string,
  defaultValue?: string,
): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(`  ${question}: `);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let input = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.removeListener("data", onData);
          stdin.setRawMode(wasRaw);
          stdin.pause();
          process.stdout.write("\n");
          resolve(input);
          return;
        } else if (ch === "\u0003") {
          process.exit(0);
        } else if (ch === "\u007F" || ch === "\b") {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else {
          input += ch;
          process.stdout.write("*");
        }
      }
    };
    stdin.on("data", onData);
  });
}

function getLaunchConfig(): ServerLaunchConfig {
  const command = process.env.COGNIGY_MCP_INIT_COMMAND || "npx";
  const rawArgs = process.env.COGNIGY_MCP_INIT_ARGS;

  if (!rawArgs) {
    return {
      command,
      args: ["-y", "@cognigy/mcp-server"],
    };
  }

  try {
    const args = JSON.parse(rawArgs);
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
      throw new Error();
    }

    return { command, args };
  } catch {
    throw new Error(
      'COGNIGY_MCP_INIT_ARGS must be a JSON string array, for example ["scripts/run-local-mcp.sh"].',
    );
  }
}

function generateServerBlock(apiBaseUrl: string, apiKey: string) {
  const launchConfig = getLaunchConfig();

  return {
    command: launchConfig.command,
    args: launchConfig.args,
    env: {
      COGNIGY_API_BASE_URL: apiBaseUrl,
      COGNIGY_API_KEY: apiKey,
    },
  };
}

function toTomlString(value: string): string {
  return JSON.stringify(value);
}

function generateCodexServerBlock(apiBaseUrl: string, apiKey: string) {
  const launchConfig = getLaunchConfig();

  return [
    "[mcp_servers.cognigy]",
    `command = ${toTomlString(launchConfig.command)}`,
    `args = [${launchConfig.args.map((arg) => toTomlString(arg)).join(", ")}]`,
    "",
    "[mcp_servers.cognigy.env]",
    `COGNIGY_API_BASE_URL = ${toTomlString(apiBaseUrl)}`,
    `COGNIGY_API_KEY = ${toTomlString(apiKey)}`,
  ].join("\n");
}

function stripCodexServerBlock(content: string): string {
  const lines = content.split("\n");
  const kept: string[] = [];
  let skip = false;

  for (const line of lines) {
    const tableMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (tableMatch) {
      const tableName = tableMatch[1].trim();
      skip =
        tableName === "mcp_servers.cognigy" ||
        tableName.startsWith("mcp_servers.cognigy.");
    }

    if (!skip) {
      kept.push(line);
    }
  }

  return kept.join("\n").trimEnd();
}

function mergeCodexConfig(
  configPath: string,
  apiBaseUrl: string,
  apiKey: string,
) {
  const existing = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, "utf-8")
    : "";
  const cleaned = stripCodexServerBlock(existing);
  const serverBlock = generateCodexServerBlock(apiBaseUrl, apiKey);
  const nextContent = cleaned
    ? `${cleaned}\n\n${serverBlock}\n`
    : `${serverBlock}\n`;

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, nextContent);
}

function mergeConfig(
  configPath: string,
  apiBaseUrl: string,
  apiKey: string,
  wrapKey?: string,
) {
  let config: any = {};

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf-8");
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

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

export async function runInit(args: string[]) {
  const clientIdx = args.indexOf("--client");
  const clientKey = clientIdx !== -1 ? args[clientIdx + 1] : undefined;

  console.log("");
  console.log("  ╔═══════════════════════════════════════════════╗");
  console.log("  ║                                               ║");
  console.log("  ║       C O G N I G Y   M C P   S E R V E R     ║");
  console.log("  ║              Installation Setup               ║");
  console.log("  ║                                               ║");
  console.log("  ╚═══════════════════════════════════════════════╝");
  console.log("");

  if (!clientKey || !CLIENTS[clientKey]) {
    console.log("  Usage: npx @cognigy/mcp-server init --client <client>");
    console.log("");
    console.log("  Supported clients:");
    for (const [key, { name }] of Object.entries(CLIENTS)) {
      console.log(`    --client ${key.padEnd(14)} ${name}`);
    }
    console.log("");
    process.exit(1);
  }

  const client = CLIENTS[clientKey];
  const configPath = client.configPath();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  if (client.gitignoreEntry) {
    console.log(`  Config will be written to: ${configPath}`);
    console.log(`  (project directory: ${process.cwd()})`);
    console.log("");
    const confirm = await prompt(
      rl,
      "Is this the correct project directory?",
      "Y",
    );
    if (confirm.toLowerCase() !== "y") {
      console.log("");
      console.log("  Run this command again from your project directory:");
      console.log(`    cd /path/to/your/project`);
      console.log(`    npx @cognigy/mcp-server init --client ${clientKey}`);
      console.log("");
      process.exit(0);
    }
  }

  const apiBaseUrl = await prompt(
    rl,
    "Cognigy API URL",
    "https://api-trial.cognigy.ai",
  );

  rl.close();
  let apiKey = "";
  while (!apiKey) {
    apiKey = await promptSecret("Cognigy API Key");
    if (!apiKey) console.log("  API key is required.");
  }

  if (client.install) {
    client.install(apiBaseUrl, apiKey);
  } else {
    mergeConfig(configPath, apiBaseUrl, apiKey, client.wrapKey);
  }

  console.log("");
  console.log(`  ✓ ${client.name} configured`);
  console.log(`    ${configPath}`);

  if (client.gitignoreEntry) {
    const gitignorePath = path.join(process.cwd(), ".gitignore");
    let alreadyIgnored = false;

    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, "utf-8");
      alreadyIgnored = content
        .split("\n")
        .some((line) => line.trim() === client.gitignoreEntry);
    }

    if (!alreadyIgnored) {
      const rl2 = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      console.log("");
      console.log(`  ⚠ ${client.gitignoreEntry} contains your API key.`);
      const answer = await prompt(
        rl2,
        `Add ${client.gitignoreEntry} to .gitignore?`,
        "Y",
      );
      rl2.close();
      if (answer.toLowerCase() === "y") {
        const newline =
          fs.existsSync(gitignorePath) &&
          !fs.readFileSync(gitignorePath, "utf-8").endsWith("\n")
            ? "\n"
            : "";
        fs.appendFileSync(
          gitignorePath,
          `${newline}${client.gitignoreEntry}\n`,
        );
        console.log(`  ✓ Added to .gitignore`);
      } else {
        console.log(
          `  → Remember to add ${client.gitignoreEntry} to .gitignore manually.`,
        );
      }
    }
  }

  console.log("");
  console.log(`  Restart ${client.name} to load the Cognigy MCP server.`);
  console.log("");
}

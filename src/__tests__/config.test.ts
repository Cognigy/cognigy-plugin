import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

// Mock the on-disk fallback so tests never touch the real ~/.cognigy-plugin.
// Default: empty (behaves as if no fallback file exists).
const readUserConfigFile = jest.fn<() => Record<string, string>>(() => ({}));
jest.unstable_mockModule("../userConfigFile.js", () => ({
  readUserConfigFile,
  writeUserConfigFile: jest.fn(),
  USER_CONFIG_FILE: "/fake/.cognigy-plugin/config.json",
  USER_CONFIG_DIR: "/fake/.cognigy-plugin",
}));

const { loadConfig } = await import("../config.js");

describe("loadConfig", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    readUserConfigFile.mockReset();
    readUserConfigFile.mockReturnValue({});
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("throws when COGNIGY_API_BASE_URL is missing", () => {
    delete process.env.COGNIGY_API_BASE_URL;
    process.env.COGNIGY_API_KEY = "test-key";
    expect(() => loadConfig()).toThrow(/COGNIGY_API_BASE_URL is not set/);
  });

  it("throws when COGNIGY_API_KEY is missing", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    delete process.env.COGNIGY_API_KEY;
    expect(() => loadConfig()).toThrow(/COGNIGY_API_KEY is not set/);
  });

  it("normalizes bare UI URL to API URL", () => {
    process.env.COGNIGY_API_BASE_URL = "https://dev.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    const config = loadConfig();
    expect(config.apiBaseUrl).toBe("https://api-dev.cognigy.ai");
  });

  it("keeps already-correct API URL unchanged", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    const config = loadConfig();
    expect(config.apiBaseUrl).toBe("https://api-trial.cognigy.ai");
  });

  it("strips trailing slashes from API URL", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai///";
    process.env.COGNIGY_API_KEY = "test-key";
    const config = loadConfig();
    expect(config.apiBaseUrl).toBe("https://api-trial.cognigy.ai");
  });

  it("derives endpoint URL from API URL", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    const config = loadConfig();
    expect(config.endpointBaseUrl).toBe("https://endpoint-trial.cognigy.ai");
  });

  it("derives webchat URL from API URL", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    const config = loadConfig();
    expect(config.webchatBaseUrl).toBe("https://webchat-trial.cognigy.ai");
  });

  it("derives endpoint/static/webchat URLs from a tenant host with a prefixed api- segment", () => {
    process.env.COGNIGY_API_BASE_URL = "https://cognigy-api-na1.nicecxone.com";
    process.env.COGNIGY_API_KEY = "test-key";
    const config = loadConfig();
    expect(config.apiBaseUrl).toBe("https://cognigy-api-na1.nicecxone.com");
    expect(config.endpointBaseUrl).toBe(
      "https://cognigy-endpoint-na1.nicecxone.com",
    );
    expect(config.webchatBaseUrl).toBe(
      "https://cognigy-webchat-na1.nicecxone.com",
    );
    expect(config.staticFilesBaseUrl).toBe(
      "https://cognigy-static-na1.nicecxone.com",
    );
  });

  it("does not match 'api-' occurring mid-segment instead of at a segment boundary", () => {
    process.env.COGNIGY_API_BASE_URL = "https://myapi-dev.example.com";
    process.env.COGNIGY_API_KEY = "test-key";
    const config = loadConfig();
    expect(config.endpointBaseUrl).toBe("https://myapi-dev.example.com");
    expect(config.webchatBaseUrl).toBe("https://myapi-dev.example.com");
    expect(config.staticFilesBaseUrl).toBe("https://myapi-dev.example.com");
  });

  it("uses explicit COGNIGY_ENDPOINT_BASE_URL if provided", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    process.env.COGNIGY_ENDPOINT_BASE_URL =
      "https://custom-endpoint.example.com";
    const config = loadConfig();
    expect(config.endpointBaseUrl).toBe("https://custom-endpoint.example.com");
  });

  it("uses explicit COGNIGY_WEBCHAT_BASE_URL if provided", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    process.env.COGNIGY_WEBCHAT_BASE_URL = "https://custom-webchat.example.com";
    const config = loadConfig();
    expect(config.webchatBaseUrl).toBe("https://custom-webchat.example.com");
  });

  it("defaults serverName to cognigy-api-mcp", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    delete process.env.MCP_SERVER_NAME;
    const config = loadConfig();
    expect(config.serverName).toBe("cognigy-api-mcp");
  });

  it("uses custom MCP_SERVER_NAME if provided", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    process.env.MCP_SERVER_NAME = "my-custom-server";
    const config = loadConfig();
    expect(config.serverName).toBe("my-custom-server");
  });

  it("defaults logLevel to info", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    delete process.env.LOG_LEVEL;
    const config = loadConfig();
    expect(config.logLevel).toBe("info");
  });

  it.each(["debug", "warn", "error"] as const)(
    "accepts valid log level: %s",
    (level) => {
      process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
      process.env.COGNIGY_API_KEY = "test-key";
      process.env.LOG_LEVEL = level;
      const config = loadConfig();
      expect(config.logLevel).toBe(level);
    },
  );

  it("falls back to info for invalid LOG_LEVEL", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    process.env.LOG_LEVEL = "verbose";
    const config = loadConfig();
    expect(config.logLevel).toBe("info");
  });

  it("parses RATE_LIMIT_MAX_REQUESTS correctly", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    process.env.RATE_LIMIT_MAX_REQUESTS = "50";
    const config = loadConfig();
    expect(config.rateLimit.maxRequests).toBe(50);
  });

  it("defaults rate limit values when env vars not set", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    delete process.env.RATE_LIMIT_MAX_REQUESTS;
    delete process.env.RATE_LIMIT_WINDOW_MS;
    const config = loadConfig();
    expect(config.rateLimit.maxRequests).toBe(100);
    expect(config.rateLimit.windowMs).toBe(60000);
  });

  it("falls back to defaults for non-numeric rate limit values", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    process.env.RATE_LIMIT_MAX_REQUESTS = "not-a-number";
    process.env.RATE_LIMIT_WINDOW_MS = "abc";
    const config = loadConfig();
    expect(config.rateLimit.maxRequests).toBe(100);
    expect(config.rateLimit.windowMs).toBe(60000);
  });

  describe("on-disk fallback (setup CLI)", () => {
    it("does not read the fallback file when both env vars are set", () => {
      process.env.COGNIGY_API_BASE_URL = "https://api-dev.cognigy.ai";
      process.env.COGNIGY_API_KEY = "env-key";
      loadConfig();
      expect(readUserConfigFile).not.toHaveBeenCalled();
    });

    it("sources both values from the file when env vars are absent", () => {
      delete process.env.COGNIGY_API_BASE_URL;
      delete process.env.COGNIGY_API_KEY;
      readUserConfigFile.mockReturnValue({
        COGNIGY_API_BASE_URL: "https://api-trial.cognigy.ai",
        COGNIGY_API_KEY: "file-key",
      });
      const config = loadConfig();
      expect(config.apiBaseUrl).toBe("https://api-trial.cognigy.ai");
      expect(config.apiKey).toBe("file-key");
    });

    it("lets an env var take precedence over the file per-field", () => {
      delete process.env.COGNIGY_API_BASE_URL;
      process.env.COGNIGY_API_KEY = "env-key";
      readUserConfigFile.mockReturnValue({
        COGNIGY_API_BASE_URL: "https://api-trial.cognigy.ai",
        COGNIGY_API_KEY: "file-key",
      });
      const config = loadConfig();
      expect(config.apiBaseUrl).toBe("https://api-trial.cognigy.ai"); // from file
      expect(config.apiKey).toBe("env-key"); // env wins
    });

    it("points users at the setup command when nothing is configured", () => {
      delete process.env.COGNIGY_API_BASE_URL;
      delete process.env.COGNIGY_API_KEY;
      expect(() => loadConfig()).toThrow(/setup/);
    });
  });

  // Hosts that don't implement the `userConfig` manifest extension (VS Code,
  // Kiro, …) pass "${user_config.cognigy_api_key}" through verbatim. Those
  // strings are non-empty, so without this handling they both masquerade as
  // real credentials and shadow the on-disk fallback.
  describe("unexpanded userConfig placeholders", () => {
    const BASE_PLACEHOLDER = "${user_config.cognigy_api_base_url}";
    const KEY_PLACEHOLDER = "${user_config.cognigy_api_key}";

    it("treats placeholder env values as unset and reads the file instead", () => {
      process.env.COGNIGY_API_BASE_URL = BASE_PLACEHOLDER;
      process.env.COGNIGY_API_KEY = KEY_PLACEHOLDER;
      readUserConfigFile.mockReturnValue({
        COGNIGY_API_BASE_URL: "https://api-trial.cognigy.ai",
        COGNIGY_API_KEY: "file-key",
      });
      const config = loadConfig();
      expect(config.apiBaseUrl).toBe("https://api-trial.cognigy.ai");
      expect(config.apiKey).toBe("file-key");
    });

    it("does not use a placeholder as the API base URL", () => {
      process.env.COGNIGY_API_BASE_URL = BASE_PLACEHOLDER;
      process.env.COGNIGY_API_KEY = "real-key";
      readUserConfigFile.mockReturnValue({
        COGNIGY_API_BASE_URL: "https://api-trial.cognigy.ai",
      });
      // Previously the placeholder survived normalisation and reached axios as
      // a baseURL, producing ERR_INVALID_URL on the first request.
      expect(loadConfig().apiBaseUrl).toBe("https://api-trial.cognigy.ai");
    });

    it("explains the placeholder in the error when no fallback exists", () => {
      process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
      process.env.COGNIGY_API_KEY = KEY_PLACEHOLDER;
      expect(() => loadConfig()).toThrow(/did not substitute/);
    });

    it("tolerates surrounding whitespace around a placeholder", () => {
      process.env.COGNIGY_API_BASE_URL = `  ${BASE_PLACEHOLDER}  `;
      process.env.COGNIGY_API_KEY = "real-key";
      readUserConfigFile.mockReturnValue({
        COGNIGY_API_BASE_URL: "https://api-trial.cognigy.ai",
      });
      expect(loadConfig().apiBaseUrl).toBe("https://api-trial.cognigy.ai");
    });

    it("keeps real values that merely contain a dollar sign", () => {
      process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
      process.env.COGNIGY_API_KEY = "ab$c{def}";
      expect(loadConfig().apiKey).toBe("ab$c{def}");
    });
  });
});

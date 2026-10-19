import { activate } from "../../scripts/dev-plugin.mjs";

function fakeClaude(configureOut: string | null) {
  const calls: string[][] = [];
  const run = (args: string[]) => {
    calls.push(args);
    return args[1] === "configure" ? configureOut : "";
  };
  return { calls, run };
}

const target = {
  plugin: "cognigy@cognigy-dev",
  marketplaceSource: "/repo/.dev-plugin",
  other: "cognigy@cognigy-plugin",
};

describe("dev-plugin activate", () => {
  it("switches by disable/enable and never deletes saved userConfig", () => {
    const { calls, run } = fakeClaude('{"unconfigured":[]}');
    expect(activate(target, run)).toEqual([]);
    expect(calls).toEqual([
      ["plugin", "disable", "cognigy@cognigy-plugin"],
      ["plugin", "marketplace", "add", "/repo/.dev-plugin"],
      ["plugin", "install", "cognigy@cognigy-dev"],
      ["plugin", "enable", "cognigy@cognigy-dev"],
      ["plugin", "configure", "cognigy@cognigy-dev", "--json"],
    ]);
    // uninstall and `marketplace remove` both wipe the plugin's userConfig.
    for (const args of calls) {
      expect(args).not.toContain("uninstall");
      expect(args).not.toContain("remove");
    }
  });

  it("reports unset userConfig keys, or null when the CLI can't tell", () => {
    expect(
      activate(target, fakeClaude('{"unconfigured":["cognigy_api_key"]}').run),
    ).toEqual(["cognigy_api_key"]);
    expect(activate(target, fakeClaude(null).run)).toBeNull();
  });
});

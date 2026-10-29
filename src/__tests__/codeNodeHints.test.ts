import { describe, it, expect } from "@jest/globals";
import { codeNodeWarnings } from "../tools/codeNodeHints.js";

describe("codeNodeWarnings", () => {
  it.each([
    ["plain input mutation", "input.result = input.httprequest.result;"],
    ["module globals", "const t = moment.utc(); const l = _.last([1]);"],
    [
      "documented api methods",
      "api.say('hi'); api.addToContext('k', 1, 'simple');",
    ],
    ["a method named fetch on an object", "const r = repo.fetch(1);"],
    ["the word require in an identifier", "const requiredFields = 3;"],
    [
      "banned names inside strings",
      'api.say("Call fetch() from the client, not require()");',
    ],
    [
      "banned names inside template literals",
      "api.say(`no XMLHttpRequest here, ${input.text}`);",
    ],
    [
      "banned names inside comments",
      "// TODO: replace fetch() with an HTTP node\n/* api.setState('x') */\napi.say('ok');",
    ],
  ])("says nothing about %s", (_name, code) => {
    expect(codeNodeWarnings(code)).toEqual([]);
  });

  it.each([
    [
      "api.httpRequest",
      "const r = await api.httpRequest({ url: 'https://x' });",
      "api.httpRequest()",
    ],
    ["fetch", "await fetch('https://x');", "fetch()/XMLHttpRequest"],
    [
      "globalThis.fetch",
      "await globalThis.fetch('https://x');",
      "fetch()/XMLHttpRequest",
    ],
    [
      "XMLHttpRequest",
      "const x = new XMLHttpRequest();",
      "fetch()/XMLHttpRequest",
    ],
    ["require", "const c = require('xml-js');", "require()/import"],
    ["static import", "import { a } from 'b';", "require()/import"],
    ["side-effect import", "import 'side-effect';", "require()/import"],
    ["dynamic import", "const m = await import('x');", "require()/import"],
    [
      "removed state methods",
      "api.setState('a'); api.getState();",
      "Intent Conditions",
    ],
  ])("flags %s", (_name, code, expected) => {
    const hints = codeNodeWarnings(code);
    expect(hints).toHaveLength(2);
    expect(hints[0]).toContain(expected);
    expect(hints[1]).toContain("local helper");
  });

  it("collects independent hints together, caveat last", () => {
    const hints = codeNodeWarnings(
      "const a = require('axios');\nawait fetch('x');\napi.resetState();",
    );
    expect(hints).toHaveLength(4);
    expect(hints[3]).toContain("local helper");
  });

  describe("readability", () => {
    it("flags a node over 60 lines", () => {
      const code = Array.from(
        { length: 61 },
        (_, i) => `input.k${i} = ${i};`,
      ).join("\n");
      const hints = codeNodeWarnings(code);
      expect(hints).toHaveLength(1);
      expect(hints[0]).toContain("61 lines");
    });

    it("flags several statements crammed on one line, ignoring string contents", () => {
      expect(
        codeNodeWarnings("input.a = 1; input.b = 2; input.c = 3;"),
      ).toHaveLength(1);
      expect(codeNodeWarnings("input.a = 'x; y; z;';")).toHaveLength(0);
    });

    it("flags a line past 160 characters", () => {
      expect(codeNodeWarnings(`input.a = ${"x".repeat(170)};`)).toHaveLength(1);
    });

    it("stays quiet on short, formatted code and appends after runtime hints", () => {
      expect(
        codeNodeWarnings("input.a = 1;\ninput.b = 2;\ninput.c = 3;"),
      ).toHaveLength(0);
      const hints = codeNodeWarnings(
        "await fetch('x'); input.a = 1; input.b = 2;",
      );
      expect(hints).toHaveLength(3);
      expect(hints[2]).toContain("one statement per line");
    });
  });
});

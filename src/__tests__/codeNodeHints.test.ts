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
      "const a = require('axios'); await fetch('x'); api.resetState();",
    );
    expect(hints).toHaveLength(4);
    expect(hints[3]).toContain("local helper");
  });
});

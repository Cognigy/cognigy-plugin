import { describe, it, expect } from "@jest/globals";
import { codeNodeFix, codeNodeWarnings } from "../tools/codeNodeHints.js";

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
    const lines = (n: number) =>
      Array.from({ length: n }, (_, i) => `input.k${i} = ${i};`).join("\n");

    it("flags a node over 60 lines, not at 60", () => {
      expect(codeNodeWarnings(lines(60))).toEqual([]);
      const hints = codeNodeWarnings(lines(61));
      expect(hints).toHaveLength(1);
      expect(hints[0]).toContain("61 lines");
    });

    it("flags several statements crammed on one line, ignoring string contents", () => {
      expect(
        codeNodeWarnings("input.a = 1; input.b = 2; input.c = 3;"),
      ).toHaveLength(1);
      expect(codeNodeWarnings("input.a = 'x; y; z;';")).toHaveLength(0);
    });

    it("does not count semicolons inside regex literals or type members", () => {
      expect(
        codeNodeWarnings('input.cleaned = input.text.replace(/;;;+/g, ";");'),
      ).toHaveLength(0);
      expect(
        codeNodeWarnings(
          "type CartItem = { name: string; price: number; quantity: number };",
        ),
      ).toHaveLength(0);
      expect(
        codeNodeWarnings(
          "const n = total / count / 2; input.a = 1; input.b = 2;",
        ),
      ).toHaveLength(1);
    });

    it.each([
      ["an if block", "if (ready) { input.a = 1; input.b = 2; input.c = 3; }"],
      [
        "an arrow function body",
        "const f = () => { input.a = 1; input.b = 2; input.c = 3; };",
      ],
      [
        "statements without a trailing semicolon",
        "input.a = 1; input.b = 2; input.c = 3",
      ],
      [
        "a string after a regex literal that holds a quote",
        "input.r = 'a' + /x'/.source + 'b; c; d; e'; input.s = 1; input.t = 2;",
      ],
    ])("flags %s crammed on one line", (_name, code) => {
      expect(codeNodeWarnings(code)).toEqual([
        expect.stringContaining("one statement per line"),
      ]);
    });

    it.each([
      ["a for header", "for (let i = 0; i < n; i++) total += xs[i];"],
      [
        "a regex literal after + that holds a quote",
        "input.r = 'a' + /x'/.source + 'b; c; d; e';",
      ],
      [
        "a block comment spanning lines",
        "input.a = 1; /* c\n c */ input.b = 2; input.c = 3;",
      ],
      [
        "a template literal spanning lines",
        "input.a = `x;\ny; z;`; input.b = 2;\ninput.c = 3;",
      ],
      [
        "a nested type literal",
        "type Cart = { item: { name: string; price: number }; count: number };",
      ],
    ])("says nothing about %s", (_name, code) => {
      expect(codeNodeWarnings(code)).toEqual([]);
    });

    it("keeps division after a closing brace, so fetch() is still found", () => {
      const hints = codeNodeWarnings(
        "const result = { value: 1 } / fetch(input.url) / 2;",
      );
      expect(hints[0]).toContain("fetch()/XMLHttpRequest");
    });

    it("flags a line past 160 characters, not at 160", () => {
      const line = (n: number) => `input.a = ${"x".repeat(n - 11)};`;
      expect(line(160)).toHaveLength(160);
      expect(codeNodeWarnings(line(160))).toEqual([]);
      expect(codeNodeWarnings(line(161))).toHaveLength(1);
    });

    it("stays quiet on short, formatted code and comes before runtime hints", () => {
      expect(
        codeNodeWarnings("input.a = 1;\ninput.b = 2;\ninput.c = 3;"),
      ).toHaveLength(0);
      const hints = codeNodeWarnings(
        "await fetch('x'); input.a = 1; input.b = 2;",
      );
      expect(hints).toHaveLength(3);
      expect(hints[0]).toContain("one statement per line");
      expect(hints[2]).toContain("local helper");
    });
  });

  describe("codeNodeFix", () => {
    it.each([
      ["nothing", "input.a = 1;", ""],
      [
        "a runtime call",
        "await fetch('x');",
        "If the flagged call is real, replace it",
      ],
      [
        "crammed code",
        "input.a = 1; input.b = 2; input.c = 3;",
        "Reformat the code",
      ],
      [
        "both",
        "await fetch('x'); input.a = 1; input.b = 2;",
        "and reformat or split",
      ],
    ])("names the fix for %s", (_name, code, expected) => {
      const fix = codeNodeFix(code);
      if (expected) expect(fix).toContain(expected);
      else expect(fix).toBe("");
    });
  });
});

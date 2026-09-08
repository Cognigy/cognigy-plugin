import { describe, it, expect } from "@jest/globals";
import { validateCodeNode } from "../tools/codeNodeValidation.js";

describe("validateCodeNode", () => {
  describe("accepts everything the platform supports", () => {
    it.each([
      [
        "regex after a condition",
        "if (input.text) /XMLHttpRequest/.test(input.text);",
      ],
      [
        "second variable binding",
        "const enabled = true, fetch = () => 42; input.result = fetch();",
      ],
      [
        "property call with whitespace",
        "const repo = { fetch: () => 42 }; input.result = repo. fetch();",
      ],
      [
        "typed callback parameter",
        "function run(fetch: () => number): number { return fetch(); }",
      ],
      [
        "local api object",
        "const api = { getState: () => 42 }; input.result = api.getState();",
      ],
      ["plain input mutation", "input.result = input.httprequest.result;"],
      [
        "type-only imports",
        "import type { Response } from 'client'; import { type Request } from 'client';",
      ],
      [
        "locally bound global object",
        "const globalThis = { fetch: () => 42 }; globalThis.fetch();",
      ],
      [
        "comment about nested deletion",
        "// api.deleteContext('a.b')\ndelete context.a.b;",
      ],
      [
        "literal describing nested deletion",
        "api.say(`api.deleteContext('a.b')`);",
      ],
      ["malformed source is left to the platform", "api.say('unterminated"],
      [
        "direct context assignment (persists for the session)",
        "context.date = new Date().toLocaleString();",
      ],
      ["nested delete via the delete operator", "delete context.x.y;"],
      ["module globals", "const t = moment.utc(); const l = _.last([1]);"],
      [
        "xmljs global",
        "const r = xmljs.xml2json(input.text, { compact: true });",
      ],
      [
        "documented api methods, incl. ones outside any team allowlist",
        "api.setTimezoneOffset(60); api.mergeProfile({}); api.say('hi');",
      ],
      ["a method named fetch on an object", "const r = repo.fetch(1);"],
      ["the word require in an identifier", "const requiredFields = 3;"],
      ["Intl", "new Intl.NumberFormat('de-DE').format(1)"],
      ["no try/catch, no particular shape", "api.output('ok');"],
      ["top-level deleteContext", 'api.deleteContext("x");'],
      [
        "banned names inside strings",
        'api.say("Call fetch() from the client, not require()");',
      ],
      [
        "banned names inside template literals",
        "api.say(`use ${input.text} — no XMLHttpRequest here`);",
      ],
      [
        "banned names inside comments",
        "// TODO: replace fetch() with an HTTP node\n/* api.setState('x') */\napi.say('ok');",
      ],
      [
        "banned names inside regex literals",
        "input.isXhr = /XMLHttpRequest/.test(input.text); const re = /fetch\\(|require\\(/gi;",
      ],
      [
        "regex literal after return",
        "return /api\\.setState/.test(input.text);",
      ],
      [
        "regex literal with a quote inside, followed by real code",
        "const q = /[\"']/g; api.say(input.text.replace(q, ''));",
      ],
      [
        "a locally declared function named fetch",
        "function fetch() { return 42; } input.result = fetch();",
      ],
      [
        "an object method named fetch",
        "const repo = { fetch(id) { return id; } }; input.r = repo.fetch(1);",
      ],
      [
        "a class method named fetch",
        "class Repo { async fetch(id) { return id; } } input.r = new Repo().fetch(1);",
      ],
      [
        "a const arrow function named fetch",
        "const fetch = (u) => u; input.r = fetch('x');",
      ],
      [
        "fetch bound by destructuring",
        "const { fetch, other } = input.helpers; input.r = fetch('x');",
      ],
      [
        "fetch as a parameter",
        "const run = (fetch) => fetch(1); function go(a, fetch) { return fetch(a); }",
      ],
      [
        "a locally declared function named require",
        "function require(x) { return x; } input.r = require('a');",
      ],
      [
        "an object key named XMLHttpRequest",
        "input.caps = { XMLHttpRequest: false };",
      ],
      [
        "feature detection via typeof",
        "input.hasXhr = typeof XMLHttpRequest !== 'undefined';",
      ],
      [
        "banned names inside a nested template literal",
        "api.say(`outer ${`fetch() ${input.text}`} done`);",
      ],
      [
        "banned names inside a string within an interpolation",
        "api.say(`${\"fetch()\"} ${'require()'}`);",
      ],
    ])("%s", (_name, code) => {
      expect(validateCodeNode(code)).toEqual({ errors: [], warnings: [] });
    });
  });

  describe("rejects what the runtime does not have", () => {
    it("a binding in another scope does not hide an unavailable global", () => {
      expect(
        validateCodeNode("function run(fetch) { return fetch(); } fetch('x');")
          .errors,
      ).toHaveLength(1);
    });
    it("api.httpRequest (Functions-only)", () => {
      const { errors } = validateCodeNode(
        "const r = await api.httpRequest({ url: 'https://x' });",
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("api.httpRequest()");
      expect(errors[0]).toContain("HTTP Request node");
    });

    it.each([
      "(fetch)('x');",
      "(fetch as any)('x');",
      "globalThis['fetch']('x');",
      "api['getState']();",
      "import client = require('client');",
    ])("recognizes executable calls in %s", (source) => {
      expect(validateCodeNode(source).errors).toHaveLength(1);
    });

    it("global-qualified fetch/require", () => {
      expect(validateCodeNode("globalThis.fetch('x');").errors).toHaveLength(1);
      expect(validateCodeNode("window.fetch('x');").errors).toHaveLength(1);
      expect(
        validateCodeNode("const m = globalThis.require('x');").errors,
      ).toHaveLength(1);
    });

    it("fetch and XMLHttpRequest", () => {
      expect(validateCodeNode("await fetch('https://x');").errors).toHaveLength(
        1,
      );
      expect(
        validateCodeNode("const x = new XMLHttpRequest();").errors,
      ).toHaveLength(1);
    });

    it("require and import", () => {
      for (const code of [
        "const c = require('xml-js');",
        'import x from "y";',
        "import { a } from 'b';",
        "import 'side-effect';",
        "const m = await import('x');",
      ]) {
        const { errors } = validateCodeNode(code);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain(
          "moment, _ (Lodash), xmljs, getTextCleaner",
        );
      }
    });

    it("removed state methods, reported once per method", () => {
      const { errors } = validateCodeNode(
        "api.setState('a'); api.setState('b'); api.getState();",
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("api.setState()");
      expect(errors[0]).toContain("api.getState()");
      expect(errors[0]).toContain("Intent Conditions");
    });

    it("calls inside template literal interpolations", () => {
      expect(
        validateCodeNode("api.say(`State: ${api.getState()}`);").errors,
      ).toHaveLength(1);
      expect(
        validateCodeNode("api.say(`${await fetch('https://x')}`);").errors,
      ).toHaveLength(1);
      expect(
        validateCodeNode("api.say(`a ${`b ${require('x')}`} c`);").errors,
      ).toHaveLength(1);
    });

    it("a division is not mistaken for a regex literal", () => {
      expect(
        validateCodeNode("const r = a / b / c; await fetch('x');").errors,
      ).toHaveLength(1);
      expect(
        validateCodeNode("const r = (a) / 2 / 3; await fetch('x');").errors,
      ).toHaveLength(1);
    });

    it("a condition head is not mistaken for a parameter list", () => {
      expect(
        validateCodeNode("if (fetch('x')) { api.say('y'); }").errors,
      ).toHaveLength(1);
      expect(
        validateCodeNode("while (require('x')) { break; }").errors,
      ).toHaveLength(1);
    });

    it("global-qualified fetch even when a local fetch exists", () => {
      expect(
        validateCodeNode("function fetch() {} globalThis.fetch('x');").errors,
      ).toHaveLength(1);
    });

    it("collects independent errors together", () => {
      const { errors } = validateCodeNode(
        "const a = require('axios'); await fetch('x'); api.resetState();",
      );
      expect(errors).toHaveLength(3);
    });
  });

  describe("warns about documented footguns without blocking", () => {
    it("warns when template text guarantees a dot path", () => {
      expect(
        validateCodeNode("api.deleteContext(`temp.${input.key}`);").warnings,
      ).toHaveLength(1);
      expect(
        validateCodeNode("api.deleteContext(`${input.key}.temp`);").warnings,
      ).toHaveLength(1);
      expect(
        validateCodeNode("api.deleteContext(`${input.key}`);").warnings,
      ).toEqual([]);
    });
    it("dot-path api.deleteContext", () => {
      const result = validateCodeNode('api.deleteContext("temp.start");');
      expect(result.errors).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("delete context.a.b;");
    });

    it("more than 100 api.* call sites", () => {
      const code = Array.from(
        { length: 101 },
        (_, i) => `api.log('${i}');`,
      ).join("\n");
      const result = validateCodeNode(code);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("101 api.* call sites");
    });

    it("stays quiet at exactly 100 call sites", () => {
      const code = Array.from({ length: 100 }, () => "api.log('x');").join(
        "\n",
      );
      expect(validateCodeNode(code).warnings).toEqual([]);
    });
  });
});

import { describe, it, expect } from "@jest/globals";
import {
  validateCodeNode,
  stripCommentsAndStrings,
} from "../tools/codeNodeValidation.js";

describe("validateCodeNode", () => {
  describe("accepts everything the platform supports", () => {
    it.each([
      ["plain input mutation", "input.result = input.httprequest.result;"],
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
    ])("%s", (_name, code) => {
      expect(validateCodeNode(code)).toEqual({ errors: [], warnings: [] });
    });
  });

  describe("rejects what the runtime does not have", () => {
    it("api.httpRequest (Functions-only)", () => {
      const { errors } = validateCodeNode(
        "const r = await api.httpRequest({ url: 'https://x' });",
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("api.httpRequest()");
      expect(errors[0]).toContain("HTTP Request node");
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

    it("collects independent errors together", () => {
      const { errors } = validateCodeNode(
        "const a = require('axios'); await fetch('x'); api.resetState();",
      );
      expect(errors).toHaveLength(3);
    });
  });

  describe("stripCommentsAndStrings", () => {
    it("blanks literal contents and comments but keeps length and lines", () => {
      const src = 'a("x\\"y") // c\n/* m\n */ b(`t${1}`)';
      const out = stripCommentsAndStrings(src);
      expect(out).toHaveLength(src.length);
      expect(out.split("\n")).toHaveLength(3);
      expect(out).toMatch(/^a\("\s+"\)\s+\n\s+\n\s+b\(`\s+`\)$/);
    });

    it("leaves an unterminated string as-is without throwing", () => {
      expect(() => stripCommentsAndStrings('api.say("oops')).not.toThrow();
    });
  });

  describe("warns about documented footguns without blocking", () => {
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

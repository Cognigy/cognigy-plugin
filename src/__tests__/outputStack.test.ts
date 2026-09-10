import { describe, it, expect } from "@jest/globals";
import { flattenOutputStack } from "../utils/outputStack.js";

/**
 * Fixtures are real responses captured from a live Cognigy AI Agent over the
 * REST endpoint (talk_to_agent, verbose: true).
 */

// A knowledge tool emits its buffer phrase as its own message, carrying no
// _messageId, ahead of the answer.
const bufferPhraseStack = {
  text: "Let me pull up our Sumatra selections for you... Great question!",
  outputStack: [
    { text: "", data: { _cognigy: { _finishReason: "tool_calls" } } },
    {
      text: "Let me pull up our Sumatra selections for you...",
      data: { _cognigy: {} },
    },
    { text: "Great question!", data: { _cognigy: { _messageId: "d7ffb089" } } },
    { text: "", data: { _cognigy: { _finishReason: "stop" } } },
  ],
};

// A formatted answer: heading, bullet list and numbered list all arrive as
// separate entries.
const markdownStack = {
  text: "flattened by the platform with spaces",
  outputStack: [
    { text: "Here's your step-by-step guide:" },
    { text: "## V60 Pour-Over Brewing Guide" },
    { text: "**What you'll need:**" },
    { text: "- 20g coffee (medium-fine grind, like table salt)" },
    { text: "- 300g water (off-boil, around 93-96°C / 200-205°F)" },
    { text: "**Steps:**" },
    { text: "1. **Rinse the filter** – Place the paper filter in your V60." },
    {
      text: "2. **Add coffee** – Place 20g of freshly ground coffee in the filter.",
    },
    { text: "" },
  ],
};

describe("flattenOutputStack", () => {
  it("puts each message on its own line", () => {
    expect(flattenOutputStack(bufferPhraseStack)).toBe(
      "Let me pull up our Sumatra selections for you...\nGreat question!",
    );
  });

  it("keeps markdown block elements on separate lines", () => {
    const out = flattenOutputStack(markdownStack);

    expect(out).toContain("\n## V60 Pour-Over Brewing Guide\n");
    expect(out).toContain(
      "\n- 20g coffee (medium-fine grind, like table salt)\n",
    );
    expect(out).toContain("\n1. **Rinse the filter**");

    // Every block-level entry starts a line rather than trailing the previous one.
    for (const line of out.split("\n")) {
      expect(line).toBe(line.trimStart());
    }
  });

  it("does not glue a list item onto the preceding line", () => {
    const out = flattenOutputStack(markdownStack);
    expect(out).not.toMatch(/\*\*What you'll need:\*\* - 20g/);
  });

  it("drops empty and whitespace-only entries", () => {
    const out = flattenOutputStack({
      outputStack: [
        { text: "one" },
        { text: "" },
        { text: "   " },
        { text: "two" },
      ],
    });
    expect(out).toBe("one\ntwo");
  });

  it("introduces no blank lines or double spaces", () => {
    const out = flattenOutputStack(markdownStack);
    expect(out).not.toMatch(/\n\n/);
    expect(out).not.toMatch(/ {2,}/);
  });

  it("falls back to the platform text field when the stack has no usable text", () => {
    expect(
      flattenOutputStack({ text: "fallback", outputStack: [{ text: "" }] }),
    ).toBe("fallback");
    expect(flattenOutputStack({ text: "fallback" })).toBe("fallback");
  });

  it("returns an empty string when there is nothing to show", () => {
    expect(flattenOutputStack({})).toBe("");
    expect(flattenOutputStack({ outputStack: [] })).toBe("");
  });

  it("preserves entry order", () => {
    const out = flattenOutputStack({
      outputStack: [{ text: "first" }, { text: "second" }, { text: "third" }],
    });
    expect(out).toBe("first\nsecond\nthird");
  });
});

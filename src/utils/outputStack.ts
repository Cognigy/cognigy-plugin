/**
 * Flattening of a Cognigy REST response into a single text transcript.
 */

interface OutputStackEntry {
  text?: string;
}

interface EndpointResponse {
  text?: string;
  outputStack?: OutputStackEntry[];
}

/**
 * Flatten an endpoint response into one string, preserving message boundaries.
 *
 * Cognigy returns each bot message as its own `outputStack` entry — a knowledge
 * tool's buffer phrase, every bullet of a list, and each paragraph all arrive
 * separately, and a real channel renders them as separate bubbles.
 *
 * Entries are joined with a newline rather than a space. Markdown block-level
 * output (headings, bullet lists, numbered lists) must start on its own line;
 * joining on a space collapses a formatted answer into a single unreadable
 * line. A single newline is enough for lists and headings to render, while
 * consecutive prose lines still fold into one paragraph — so plain answers read
 * exactly as before. A blank line would instead make every list "loose",
 * wrapping each item in its own paragraph.
 *
 * Falls back to the response's own `text` field, which the platform flattens
 * with spaces, when the stack carries no usable text.
 */
export function flattenOutputStack(response: EndpointResponse): string {
  const texts = (response.outputStack ?? [])
    .map((entry) => entry.text)
    .filter((text): text is string => Boolean(text?.trim()));

  if (texts.length > 0) return texts.join("\n");

  return response.text ?? "";
}

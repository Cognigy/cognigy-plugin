import { describe, it, expect } from "@jest/globals";
import { supportedNodeTypes as upstreamSupportedNodeTypes } from "../../tools/nodeRegistry.js";
import { FORK_NODE_ENTRIES } from "../../policy/nodeRegistry.extensions.js";
import * as policyNodeRegistry from "../../policy/nodeRegistry.js";

/**
 * §3.7 / §5, test 5: fails the build when the fork and upstream define the
 * same node type key. The failure is the point - it forces a human to
 * decide whether upstream's entry is now sufficient (delete the fork entry)
 * or the fork's is deliberately stricter (record why in retireWhen and add
 * the key to a reviewed allowlist). Silence in either direction is the
 * failure mode being designed out.
 */
describe("node registry clash guard", () => {
  it("no fork node entry collides with an upstream node type key", () => {
    const upstreamKeys = new Set(upstreamSupportedNodeTypes());
    const clashes = Object.keys(FORK_NODE_ENTRIES).filter((key) =>
      upstreamKeys.has(key),
    );

    expect(clashes).toEqual([]);
  });

  it("the shim's supportedNodeTypes is the union of upstream and fork keys, deduplicated", () => {
    const expected = new Set([
      ...upstreamSupportedNodeTypes(),
      ...Object.keys(FORK_NODE_ENTRIES),
    ]);

    expect(new Set(policyNodeRegistry.supportedNodeTypes())).toEqual(expected);
  });
});

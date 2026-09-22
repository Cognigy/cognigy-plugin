import {
  getNodeEntry as upstreamGetNodeEntry,
  supportedNodeTypes as upstreamSupportedNodeTypes,
  type NodeRegistryEntry,
} from "../tools/nodeRegistry.js";
import { FORK_NODE_ENTRIES } from "./nodeRegistry.extensions.js";

/**
 * Wraps upstream's node registry accessors (§3.7). NODE_REGISTRY has exactly
 * one consumer pair, imported by exactly one file (handlers.ts), which makes
 * repointing that one import the entire upstream-side footprint -
 * src/tools/nodeRegistry.ts is never edited, so upstream can append entries
 * there forever with no conflict.
 *
 * Fork entries win: an upstream entry must never silently loosen a stricter
 * fork one. Replacement is wholesale, not a field-level merge, so a fork
 * entry can never end up as an untested combination of both sides.
 */
export function getNodeEntry(nodeType: string): NodeRegistryEntry | null {
  return FORK_NODE_ENTRIES[nodeType] ?? upstreamGetNodeEntry(nodeType);
}

export function supportedNodeTypes(): string[] {
  return [
    ...new Set([
      ...upstreamSupportedNodeTypes(),
      ...Object.keys(FORK_NODE_ENTRIES),
    ]),
  ];
}

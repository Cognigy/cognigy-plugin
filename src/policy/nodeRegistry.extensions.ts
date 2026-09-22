import type { NodeRegistryEntry } from "../tools/nodeRegistry.js";

/**
 * Fork-owned node registry entries (§3.7). Empty for now - no fork-specific
 * node types have been added yet. A new entry here must never collide with
 * an upstream key; registry-clash.test.ts fails loudly, naming the
 * duplicate, if it does.
 */
export const FORK_NODE_ENTRIES: Record<string, NodeRegistryEntry> = {};

import type { EnvironmentRuntime } from "../environmentRuntime.js";
import { manageEnvironmentsSchema } from "../schemas/tools.js";
import { withHints } from "./filters.js";

/**
 * manage_environments: show or switch which Cognigy environment this session
 * talks to. It is handled here, not by `ToolHandlers`: a switch replaces the
 * handlers, so they cannot be the thing that performs it.
 *
 * Nothing returned here ever contains an API key. Adding or editing
 * environments (which needs a key) is deliberately terminal-only.
 */
export function handleManageEnvironments(
  args: unknown,
  runtime: Pick<EnvironmentRuntime<unknown>, "list" | "describe" | "switchTo">,
): Record<string, unknown> {
  const data = manageEnvironmentsSchema.parse(args);

  switch (data.operation) {
    case "list": {
      const { environments, source } = runtime.list();
      return {
        environments,
        source,
        ...(environments.length === 0
          ? {
              note: 'No environments are defined. The user adds one in a terminal with "cognigy-env add <name> <base-url>".',
            }
          : {}),
      };
    }
    case "current": {
      const { name, apiBaseUrl, source } = runtime.describe();
      return { environment: name, apiBaseUrl, source };
    }
    case "use": {
      const { previous, current } = runtime.switchTo(data.name);
      return withHints(
        {
          previous,
          current: { name: current.name, apiBaseUrl: current.apiBaseUrl },
          scope: "this session only",
        },
        {
          action:
            "Resource IDs (projects, agents, flows) from the previous environment do not exist in this one; list projects again before reusing any ID.",
        },
      );
    }
  }
}

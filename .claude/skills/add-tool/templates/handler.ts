// Template: Handler method for src/tools/handlers.ts
// Replace all <PLACEHOLDERS> with actual values.

// --- Add this method to the ToolHandlers class ---

async handle<ToolName>(args: any): Promise<any> {
  const data = schemas.<toolName>Schema.parse(args);

  switch (data.operation) {
    case "<op_a>": {
      // Validate required fields for this operation
      if (!data.projectId) {
        return withHints(
          { error: "projectId is required for <op_a>" },
          { action: "Use list_resources { resourceType: 'project' } to find your project ID" },
        );
      }

      // Build payload
      const payload: any = { /* ... */ };

      // Call API
      const result = await this.apiClient.post("/v2.0/<endpoint>", payload);

      // Return filtered response
      return filterResponse("<resource_type>", result);
    }

    case "<op_b>": {
      const result = await this.apiClient.get(
        `/v2.0/<endpoint>/${data.resourceId}`,
      );
      return filterResponse("<resource_type>", result);
    }

    default:
      throw new Error(`Unknown operation: ${(data as any).operation}`);
  }
}

// --- Add this case to handleToolCall() switch ---

case "<tool_name>":
  result = await this.handle<ToolName>(args);
  break;

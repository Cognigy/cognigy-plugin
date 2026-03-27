import { describe, it, expect } from '@jest/globals';
import * as schemas from '../schemas/tools.js';

const VALID_ID = '507f1f77bcf86cd799439011';

describe('ID schema validation (via createAiAgentSchema.projectId)', () => {
  it('accepts valid 24-char hex ID', () => {
    expect(() => schemas.createAiAgentSchema.parse({
      name: 'Agent',
      projectId: VALID_ID,
    })).not.toThrow();
  });

  it('rejects too-short ID', () => {
    expect(() => schemas.createAiAgentSchema.parse({
      name: 'Agent',
      projectId: 'abc123',
    })).toThrow();
  });

  it('rejects too-long ID', () => {
    expect(() => schemas.createAiAgentSchema.parse({
      name: 'Agent',
      projectId: '507f1f77bcf86cd799439011ff',
    })).toThrow();
  });

  it('rejects non-hex characters', () => {
    expect(() => schemas.createAiAgentSchema.parse({
      name: 'Agent',
      projectId: '507f1f77bcf86cd79943ZZZZ',
    })).toThrow();

    expect(() => schemas.createAiAgentSchema.parse({
      name: 'Agent',
      projectId: '507F1F77BCF86CD799439011',
    })).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => schemas.createAiAgentSchema.parse({
      name: 'Agent',
      projectId: '',
    })).toThrow();
  });
});

describe('createAiAgentSchema', () => {
  it('accepts valid input with all fields', () => {
    const result = schemas.createAiAgentSchema.parse({
      projectId: VALID_ID,
      name: 'Test Agent',
      description: 'A test agent',
      knowledgeStoreReferenceId: 'ks-ref-123',
    });
    expect(result.name).toBe('Test Agent');
    expect(result.projectId).toBe(VALID_ID);
  });

  it('accepts minimal input (just name)', () => {
    const result = schemas.createAiAgentSchema.parse({ name: 'Minimal' });
    expect(result.name).toBe('Minimal');
    expect(result.projectId).toBeUndefined();
  });

  it('rejects empty name', () => {
    expect(() => schemas.createAiAgentSchema.parse({ name: '' })).toThrow();
  });

  it('rejects name over 200 chars', () => {
    expect(() => schemas.createAiAgentSchema.parse({
      name: 'x'.repeat(201),
    })).toThrow();
  });

  it('rejects invalid projectId format', () => {
    expect(() => schemas.createAiAgentSchema.parse({
      name: 'Agent',
      projectId: 'not-a-valid-id',
    })).toThrow();
  });
});

describe('updateAiAgentSchema', () => {
  it('accepts valid input with agent fields', () => {
    const result = schemas.updateAiAgentSchema.parse({
      aiAgentId: VALID_ID,
      name: 'Updated',
      description: 'New desc',
      instructions: 'Be helpful',
    });
    expect(result.name).toBe('Updated');
  });

  it('accepts valid input with jobConfig', () => {
    const result = schemas.updateAiAgentSchema.parse({
      aiAgentId: VALID_ID,
      jobConfig: {
        temperature: 0.7,
        maxTokens: 4000,
        jobName: 'My Job',
      },
    });
    expect(result.jobConfig!.temperature).toBe(0.7);
  });

  it('rejects temperature below 0', () => {
    expect(() => schemas.updateAiAgentSchema.parse({
      aiAgentId: VALID_ID,
      jobConfig: { temperature: -0.1 },
    })).toThrow();
  });

  it('rejects temperature above 1', () => {
    expect(() => schemas.updateAiAgentSchema.parse({
      aiAgentId: VALID_ID,
      jobConfig: { temperature: 1.5 },
    })).toThrow();
  });

  it('rejects maxTokens below 100', () => {
    expect(() => schemas.updateAiAgentSchema.parse({
      aiAgentId: VALID_ID,
      jobConfig: { maxTokens: 50 },
    })).toThrow();
  });

  it('rejects maxTokens above 8000', () => {
    expect(() => schemas.updateAiAgentSchema.parse({
      aiAgentId: VALID_ID,
      jobConfig: { maxTokens: 9000 },
    })).toThrow();
  });
});

describe('setupLlmSchema', () => {
  it('accepts valid input with apiKey', () => {
    const result = schemas.setupLlmSchema.parse({
      projectId: VALID_ID,
      provider: 'openAI',
      modelType: 'gpt-4o',
      apiKey: 'sk-abc123',
    });
    expect(result.provider).toBe('openAI');
  });

  it('accepts valid input with connectionId', () => {
    const result = schemas.setupLlmSchema.parse({
      projectId: VALID_ID,
      provider: 'anthropic',
      modelType: 'claude-3',
      connectionId: 'conn-xyz',
    });
    expect(result.connectionId).toBe('conn-xyz');
  });

  it('rejects invalid provider enum value', () => {
    expect(() => schemas.setupLlmSchema.parse({
      projectId: VALID_ID,
      provider: 'invalidProvider',
      modelType: 'gpt-4o',
    })).toThrow();
  });

  it('rejects empty modelType', () => {
    expect(() => schemas.setupLlmSchema.parse({
      projectId: VALID_ID,
      provider: 'openAI',
      modelType: '',
    })).toThrow();
  });

  it('accepts dangerouslySkipConnectionTest as optional boolean', () => {
    const result = schemas.setupLlmSchema.parse({
      projectId: VALID_ID,
      provider: 'openAI',
      modelType: 'gpt-4o',
      apiKey: 'sk-abc123',
      dangerouslySkipConnectionTest: true,
    });
    expect(result.dangerouslySkipConnectionTest).toBe(true);
  });

  it('allows omitting dangerouslySkipConnectionTest', () => {
    const result = schemas.setupLlmSchema.parse({
      projectId: VALID_ID,
      provider: 'openAI',
      modelType: 'gpt-4o',
      apiKey: 'sk-abc123',
    });
    expect(result.dangerouslySkipConnectionTest).toBeUndefined();
  });
});

describe('talkToAgentSchema', () => {
  it('accepts valid input', () => {
    const result = schemas.talkToAgentSchema.parse({
      endpointUrl: 'https://endpoint-trial.cognigy.ai/abc123',
      message: 'Hello agent',
      sessionId: 'sess-1',
    });
    expect(result.message).toBe('Hello agent');
  });

  it('rejects invalid URL', () => {
    expect(() => schemas.talkToAgentSchema.parse({
      endpointUrl: 'not-a-url',
      message: 'Hello',
    })).toThrow();
  });

  it('rejects empty message', () => {
    expect(() => schemas.talkToAgentSchema.parse({
      endpointUrl: 'https://endpoint-trial.cognigy.ai/abc123',
      message: '',
    })).toThrow();
  });
});

describe('managePackagesSchema', () => {
  it('accepts upload_and_inspect input', () => {
    const result = schemas.managePackagesSchema.parse({
      operation: 'upload_and_inspect',
      projectId: VALID_ID,
      filePath: '/tmp/support-bot.zip',
    });

    expect(result.operation).toBe('upload_and_inspect');
  });

  it('accepts inspect input', () => {
    const result = schemas.managePackagesSchema.parse({
      operation: 'inspect',
      projectId: VALID_ID,
      packageId: VALID_ID,
    });

    expect(result.operation).toBe('inspect');
  });

  it('accepts import input', () => {
    const result = schemas.managePackagesSchema.parse({
      operation: 'import',
      projectId: VALID_ID,
      packageId: VALID_ID,
      resources: [{ id: VALID_ID, strategy: 'replace' }],
      localeMapping: [{ packageLocaleId: VALID_ID, agentLocaleId: VALID_ID }],
      waitForCompletion: true,
      timeoutMs: 5000,
    });

    expect(result.operation).toBe('import');
  });

  it('accepts read_task input', () => {
    const result = schemas.managePackagesSchema.parse({
      operation: 'read_task',
      projectId: VALID_ID,
      taskId: VALID_ID,
    });

    expect(result.operation).toBe('read_task');
  });

  it('rejects invalid import strategy', () => {
    expect(() => schemas.managePackagesSchema.parse({
      operation: 'import',
      projectId: VALID_ID,
      packageId: VALID_ID,
      resources: [{ id: VALID_ID, strategy: 'abort' }],
    })).toThrow();
  });
});

describe('listResourcesSchema', () => {
  it('accepts valid resource type', () => {
    const result = schemas.listResourcesSchema.parse({
      resourceType: 'agent',
      projectId: VALID_ID,
    });
    expect(result.resourceType).toBe('agent');
  });

  it('rejects invalid resource type', () => {
    expect(() => schemas.listResourcesSchema.parse({
      resourceType: 'nonexistent',
    })).toThrow();
  });

  it('rejects limit below 1', () => {
    expect(() => schemas.listResourcesSchema.parse({
      resourceType: 'project',
      limit: 0,
    })).toThrow();
  });

  it('rejects limit above 100', () => {
    expect(() => schemas.listResourcesSchema.parse({
      resourceType: 'project',
      limit: 101,
    })).toThrow();
  });

  it('rejects negative skip', () => {
    expect(() => schemas.listResourcesSchema.parse({
      resourceType: 'project',
      skip: -1,
    })).toThrow();
  });
});

describe('createToolSchema', () => {
  it('accepts valid tool type', () => {
    const result = schemas.createToolSchema.parse({
      aiAgentId: VALID_ID,
      toolType: 'http',
      name: 'My Tool',
      config: { url: 'https://example.com' },
    });
    expect(result.toolType).toBe('http');
  });

  it('rejects invalid tool type', () => {
    expect(() => schemas.createToolSchema.parse({
      aiAgentId: VALID_ID,
      toolType: 'invalid_type',
      name: 'My Tool',
      config: {},
    })).toThrow();
  });

  it('rejects empty name', () => {
    expect(() => schemas.createToolSchema.parse({
      aiAgentId: VALID_ID,
      toolType: 'tool',
      name: '',
      config: {},
    })).toThrow();
  });

  it('accepts valid http method enum', () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      expect(() => schemas.createToolSchema.parse({
        aiAgentId: VALID_ID,
        toolType: 'http',
        name: 'Tool',
        config: { url: 'https://example.com', method },
      })).not.toThrow();
    }
  });

  it('rejects invalid http method', () => {
    expect(() => schemas.createToolSchema.parse({
      aiAgentId: VALID_ID,
      toolType: 'http',
      name: 'Tool',
      config: { url: 'https://example.com', method: 'OPTIONS' },
    })).toThrow();
  });
});

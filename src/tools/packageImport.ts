type GraphResource = {
  _id?: string;
  id?: string;
  type?: string;
  name?: string;
  referenceId?: string;
  properties?: Record<string, any>;
};

type GraphSubgraph = {
  _id?: string;
  id?: string;
  type?: string;
  name?: string;
  resources?: GraphResource[];
};

const EXCLUDED_REFERENCE_CONFLICT_TYPES = new Set([
  'extension',
  'endpoint',
  'file',
  'playbook',
]);

const RETIRED_LLM_MODELS = new Set([
  'gpt-3.5-turbo',
  'gpt-3.5-turbo-instruct',
  'gpt-4',
  'claude-v1-100k',
  'claude-3-opus-20240229',
  'claude-3-sonnet-20240229',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-latest',
  'claude-3-7-sonnet-latest',
  'claude-3-7-sonnet-20250219',
  'claude-instant-v1',
  'text-bison@001',
  'gemini-1.0-pro',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'text-davinci-003',
]);

export interface NormalizedTask {
  id: string | null;
  name: string | null;
  status: string | null;
  currentStep: number;
  totalStep: number;
  progress: number;
  failReason: string | null;
  data: Record<string, any> | null;
}

export interface PackageConflictSummary {
  type: 'referenceId';
  targetResourceId: string | null;
  targetResourceName: string | null;
}

export interface PackageResourcePreview {
  id: string;
  type: string;
  name: string;
  referenceId?: string;
  selectedByDefault: boolean;
  defaultStrategy: 'replace' | 're-identify';
  disabledReason?: 'retired_model';
  conflict?: PackageConflictSummary;
}

export interface PackageLocalePreview {
  id: string;
  name: string;
  nluLanguage: string | null;
  isPrimary: boolean;
}

export interface PackageImportPreview {
  project: {
    id: string;
    name: string | null;
  };
  package: {
    id: string;
    name: string | null;
  };
  resources: PackageResourcePreview[];
  locales: {
    packageLocales: PackageLocalePreview[];
    projectLocales: PackageLocalePreview[];
    defaultLocaleMapping: Array<{ packageLocaleId: string; agentLocaleId: string }>;
  };
  summary: {
    resourceCount: number;
    selectedByDefaultCount: number;
    disabledResourceCount: number;
    hasFlows: boolean;
    hasDuplicateKnowledgeStore: boolean;
  };
}

function resourceId(resource: GraphResource): string {
  return String(resource._id ?? resource.id ?? '');
}

function resourceName(resource: GraphResource): string {
  return resource.name || resourceId(resource);
}

function isLocale(resource: GraphResource): boolean {
  return resource.type === 'locale';
}

function isRetiredLlmModel(modelType?: string): boolean {
  return !!modelType && RETIRED_LLM_MODELS.has(modelType);
}

function buildReferenceMap(resources: GraphResource[]): Map<string, GraphResource> {
  const map = new Map<string, GraphResource>();

  for (const resource of resources) {
    if (!resource.referenceId) continue;
    if (!resource.type || EXCLUDED_REFERENCE_CONFLICT_TYPES.has(resource.type)) continue;
    if (!map.has(resource.referenceId)) {
      map.set(resource.referenceId, resource);
    }
  }

  return map;
}

function buildLocalePreview(locale: GraphResource): PackageLocalePreview {
  return {
    id: resourceId(locale),
    name: resourceName(locale),
    nluLanguage: locale.properties?.nluLanguage ?? null,
    isPrimary: !!locale.properties?.primary,
  };
}

export function getTaskProgress(task: any): number {
  if (!task) return 0;

  switch (task.status) {
    case 'queued':
    case 'cancelled':
    case 'cancelling':
    case 'error':
      return 0;
    default:
      break;
  }

  if (!task.totalStep || task.totalStep <= 0) {
    return task.status === 'done' ? 1 : 0;
  }

  if (task.currentStep === task.totalStep && task.status === 'active') {
    return task.currentStep / (task.totalStep + 1);
  }

  return task.currentStep / task.totalStep;
}

export function normalizeTask(task: any): NormalizedTask {
  return {
    id: task?._id ?? task?.id ?? null,
    name: task?.name ?? null,
    status: task?.status ?? null,
    currentStep: Number(task?.currentStep ?? 0),
    totalStep: Number(task?.totalStep ?? 0),
    progress: getTaskProgress(task),
    failReason: task?.failReason ?? null,
    data: task?.data ?? null,
  };
}

export function buildPackageImportPreview(
  projectId: string,
  packageId: string,
  graph: Record<string, GraphSubgraph>,
): PackageImportPreview {
  const projectGraph = graph[projectId];
  const packageGraph = graph[packageId];

  if (!projectGraph) {
    throw new Error(`Project graph not found for ${projectId}`);
  }

  if (!packageGraph) {
    throw new Error(`Package graph not found for ${packageId}`);
  }

  const projectResources = Array.isArray(projectGraph.resources) ? projectGraph.resources : [];
  const packageResources = Array.isArray(packageGraph.resources) ? packageGraph.resources : [];

  const projectLocales = projectResources.filter(isLocale).map(buildLocalePreview);
  const packageLocales = packageResources.filter(isLocale).map(buildLocalePreview);
  const importableResources = packageResources.filter(resource => !isLocale(resource));

  const targetByReferenceId = buildReferenceMap(projectResources);
  const defaultProjectPrimaryLocale = projectLocales.find(locale => locale.isPrimary);

  const resources: PackageResourcePreview[] = importableResources.map(resource => {
    const conflictResource = resource.referenceId
      ? targetByReferenceId.get(resource.referenceId)
      : undefined;
    const disabledReason = resource.type === 'largeLanguageModel' &&
      isRetiredLlmModel(resource.properties?.modelType)
      ? 'retired_model'
      : undefined;

    return {
      id: resourceId(resource),
      type: resource.type || 'unknown',
      name: resourceName(resource),
      ...(resource.referenceId ? { referenceId: resource.referenceId } : {}),
      selectedByDefault: !disabledReason,
      defaultStrategy: resource.type === 'knowledgeStore' ? 'replace' : 're-identify',
      ...(disabledReason ? { disabledReason } : {}),
      ...(conflictResource ? {
        conflict: {
          type: 'referenceId',
          targetResourceId: resourceId(conflictResource),
          targetResourceName: resourceName(conflictResource),
        },
      } : {}),
    };
  });

  const defaultLocaleMapping = packageLocales
    .filter(locale => locale.isPrimary)
    .flatMap(locale => (
      defaultProjectPrimaryLocale
        ? [{ packageLocaleId: locale.id, agentLocaleId: defaultProjectPrimaryLocale.id }]
        : []
    ));

  return {
    project: {
      id: projectId,
      name: projectGraph.name ?? null,
    },
    package: {
      id: packageId,
      name: packageGraph.name ?? null,
    },
    resources,
    locales: {
      packageLocales,
      projectLocales,
      defaultLocaleMapping,
    },
    summary: {
      resourceCount: resources.length,
      selectedByDefaultCount: resources.filter(resource => resource.selectedByDefault).length,
      disabledResourceCount: resources.filter(resource => !!resource.disabledReason).length,
      hasFlows: resources.some(resource => resource.type === 'flow'),
      hasDuplicateKnowledgeStore: resources.some(
        resource => resource.type === 'knowledgeStore' && !!resource.conflict,
      ),
    },
  };
}

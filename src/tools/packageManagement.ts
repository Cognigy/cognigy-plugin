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
  "extension",
  "endpoint",
  "file",
  "playbook",
]);

const EXPORTABLE_PACKAGE_TYPES = new Set([
  "connection",
  "endpoint",
  "flow",
  "function",
  "lexicon",
  "nluconnector",
  "largeLanguageModel",
  "goal",
  "knowledgeStore",
  "playbook",
  "agentAssistConfig",
  "aiAgent",
  "handoverProvider",
  "simulation",
]);

const UI_SKIPPED_EXPORT_TYPES = new Set(["function"]);

const RETIRED_LLM_MODELS = new Set([
  "gpt-3.5-turbo",
  "gpt-3.5-turbo-instruct",
  "gpt-4",
  "claude-v1-100k",
  "claude-3-opus-20240229",
  "claude-3-sonnet-20240229",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-latest",
  "claude-3-7-sonnet-latest",
  "claude-3-7-sonnet-20250219",
  "claude-instant-v1",
  "text-bison@001",
  "gemini-1.0-pro",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
  "text-davinci-003",
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
  type: "referenceId";
  targetResourceId: string | null;
  targetResourceName: string | null;
}

export interface PackageResourcePreview {
  id: string;
  type: string;
  name: string;
  referenceId?: string;
  selectedByDefault: boolean;
  defaultStrategy: "replace" | "re-identify";
  disabledReason?: "retired_model";
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
    defaultLocaleMapping: Array<{
      packageLocaleId: string;
      agentLocaleId: string;
    }>;
  };
  summary: {
    resourceCount: number;
    selectedByDefaultCount: number;
    disabledResourceCount: number;
    hasFlows: boolean;
    hasDuplicateKnowledgeStore: boolean;
  };
}

export interface PackageExportSelection {
  id: string;
  type: string;
  name: string;
  referenceId?: string;
  selectedExplicitly: boolean;
  includedAsDependency: boolean;
}

export interface PackageExportableResource {
  id: string;
  type: string;
  name: string;
  referenceId?: string;
  canExport: boolean;
  disabledReason?: "function_export_not_supported" | "retired_model";
  dependencyCount: number;
  modelType?: string;
  connectionId?: string;
}

export interface PackageExportSkippedResource {
  id: string;
  type: string;
  name: string;
  reason:
    | "missing_from_graph"
    | "unsupported_resource_type"
    | "function_export_not_supported"
    | "retired_model";
}

export interface PackageExportPlan {
  project: {
    id: string;
    name: string | null;
  };
  requestedResourceIds: string[];
  resourceIds: string[];
  selectedResources: PackageExportSelection[];
  dependencyResources: PackageExportSelection[];
  skippedResources: PackageExportSkippedResource[];
  summary: {
    selectedResourceCount: number;
    dependencyResourceCount: number;
    skippedResourceCount: number;
  };
}

export interface PackageExportablePreview {
  project: {
    id: string;
    name: string | null;
  };
  resources: PackageExportableResource[];
  summary: {
    resourceCount: number;
    exportableNowCount: number;
    disabledResourceCount: number;
    typeCounts: Array<{
      type: string;
      count: number;
      exportableNowCount: number;
    }>;
  };
}

function resourceId(resource: GraphResource): string {
  return String(resource._id ?? resource.id ?? "");
}

function resourceName(resource: GraphResource): string {
  return resource.name || resourceId(resource);
}

function isLocale(resource: GraphResource): boolean {
  return resource.type === "locale";
}

function isExportablePackageResource(resource: GraphResource): boolean {
  return !!resource.type && EXPORTABLE_PACKAGE_TYPES.has(resource.type);
}

function isRetiredLlmModel(modelType?: string): boolean {
  return !!modelType && RETIRED_LLM_MODELS.has(modelType);
}

function buildReferenceMap(
  resources: GraphResource[],
): Map<string, GraphResource> {
  const map = new Map<string, GraphResource>();

  for (const resource of resources) {
    if (!resource.referenceId) continue;
    if (!resource.type || EXCLUDED_REFERENCE_CONFLICT_TYPES.has(resource.type))
      continue;
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
    case "queued":
    case "cancelled":
    case "cancelling":
    case "error":
      return 0;
    default:
      break;
  }

  if (!task.totalStep || task.totalStep <= 0) {
    return task.status === "done" ? 1 : 0;
  }

  if (task.currentStep === task.totalStep && task.status === "active") {
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

  const projectResources = Array.isArray(projectGraph.resources)
    ? projectGraph.resources
    : [];
  const packageResources = Array.isArray(packageGraph.resources)
    ? packageGraph.resources
    : [];

  const projectLocales = projectResources
    .filter(isLocale)
    .map(buildLocalePreview);
  const packageLocales = packageResources
    .filter(isLocale)
    .map(buildLocalePreview);
  const importableResources = packageResources.filter(
    (resource) => !isLocale(resource),
  );

  const targetByReferenceId = buildReferenceMap(projectResources);
  const defaultProjectPrimaryLocale = projectLocales.find(
    (locale) => locale.isPrimary,
  );

  const resources: PackageResourcePreview[] = importableResources.map(
    (resource) => {
      const conflictResource = resource.referenceId
        ? targetByReferenceId.get(resource.referenceId)
        : undefined;
      const disabledReason =
        resource.type === "largeLanguageModel" &&
        isRetiredLlmModel(resource.properties?.modelType)
          ? "retired_model"
          : undefined;

      return {
        id: resourceId(resource),
        type: resource.type || "unknown",
        name: resourceName(resource),
        ...(resource.referenceId ? { referenceId: resource.referenceId } : {}),
        selectedByDefault: !disabledReason,
        defaultStrategy:
          resource.type === "knowledgeStore" ? "replace" : "re-identify",
        ...(disabledReason ? { disabledReason } : {}),
        ...(conflictResource
          ? {
              conflict: {
                type: "referenceId",
                targetResourceId: resourceId(conflictResource),
                targetResourceName: resourceName(conflictResource),
              },
            }
          : {}),
      };
    },
  );

  const defaultLocaleMapping = packageLocales
    .filter((locale) => locale.isPrimary)
    .flatMap((locale) =>
      defaultProjectPrimaryLocale
        ? [
            {
              packageLocaleId: locale.id,
              agentLocaleId: defaultProjectPrimaryLocale.id,
            },
          ]
        : [],
    );

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
      selectedByDefaultCount: resources.filter(
        (resource) => resource.selectedByDefault,
      ).length,
      disabledResourceCount: resources.filter(
        (resource) => !!resource.disabledReason,
      ).length,
      hasFlows: resources.some((resource) => resource.type === "flow"),
      hasDuplicateKnowledgeStore: resources.some(
        (resource) => resource.type === "knowledgeStore" && !!resource.conflict,
      ),
    },
  };
}

function buildExportSelection(
  resource: GraphResource,
  input: {
    selectedExplicitly: boolean;
    includedAsDependency: boolean;
  },
): PackageExportSelection {
  return {
    id: resourceId(resource),
    type: resource.type || "unknown",
    name: resourceName(resource),
    ...(resource.referenceId ? { referenceId: resource.referenceId } : {}),
    selectedExplicitly: input.selectedExplicitly,
    includedAsDependency: input.includedAsDependency,
  };
}

function getExportDisabledReason(
  resource: GraphResource,
): PackageExportableResource["disabledReason"] | undefined {
  if (UI_SKIPPED_EXPORT_TYPES.has(resource.type || "")) {
    return "function_export_not_supported";
  }

  if (
    resource.type === "largeLanguageModel" &&
    isRetiredLlmModel(resource.properties?.modelType)
  ) {
    return "retired_model";
  }

  return undefined;
}

function buildExportSkippedResource(
  resource: GraphResource | undefined,
  requestedId: string,
  reason: PackageExportSkippedResource["reason"],
): PackageExportSkippedResource {
  return {
    id: resource ? resourceId(resource) : requestedId,
    type: resource?.type || "unknown",
    name: resource ? resourceName(resource) : requestedId,
    reason,
  };
}

function collectDependencies(
  resourcesById: Map<string, GraphResource>,
  resource: GraphResource,
  collected: Map<string, GraphResource>,
): void {
  const dependencies = Array.isArray((resource as any)?.dependencies)
    ? ((resource as any).dependencies as GraphResource[])
    : [];

  for (const dependency of dependencies) {
    const dependencyId = resourceId(dependency);
    if (!dependencyId || collected.has(dependencyId)) continue;

    const fullDependency = resourcesById.get(dependencyId) ?? dependency;
    collected.set(dependencyId, fullDependency);
    collectDependencies(resourcesById, fullDependency, collected);
  }
}

export function buildPackageExportPlan(
  projectId: string,
  graph: Record<string, GraphSubgraph>,
  requestedResourceIds: string[],
  options?: {
    includeDependencies?: boolean;
    dependencyResourceIds?: string[];
  },
): PackageExportPlan {
  const projectGraph = graph[projectId];

  if (!projectGraph) {
    throw new Error(`Project graph not found for ${projectId}`);
  }

  if (!requestedResourceIds.length) {
    throw new Error("At least one resourceId is required for export");
  }

  const graphResources = Array.isArray(projectGraph.resources)
    ? projectGraph.resources
    : [];
  const allResourcesById = new Map<string, GraphResource>(
    graphResources.map((resource) => [resourceId(resource), resource]),
  );
  const exportableResources = graphResources.filter(
    isExportablePackageResource,
  );
  const resourcesById = new Map<string, GraphResource>(
    exportableResources.map((resource) => [resourceId(resource), resource]),
  );

  const skippedResources: PackageExportSkippedResource[] = [];
  const skippedResourceIds = new Set<string>();
  const selectedExplicitResources = new Map<string, GraphResource>();

  for (const requestedId of requestedResourceIds) {
    const resource = allResourcesById.get(requestedId);
    if (!resource) {
      skippedResources.push(
        buildExportSkippedResource(
          undefined,
          requestedId,
          "missing_from_graph",
        ),
      );
      skippedResourceIds.add(requestedId);
      continue;
    }

    if (!isExportablePackageResource(resource)) {
      skippedResources.push(
        buildExportSkippedResource(
          resource,
          requestedId,
          "unsupported_resource_type",
        ),
      );
      skippedResourceIds.add(requestedId);
      continue;
    }

    const disabledReason = getExportDisabledReason(resource);
    if (disabledReason === "function_export_not_supported") {
      skippedResources.push(
        buildExportSkippedResource(
          resource,
          requestedId,
          "function_export_not_supported",
        ),
      );
      skippedResourceIds.add(requestedId);
      continue;
    }

    if (disabledReason === "retired_model") {
      skippedResources.push(
        buildExportSkippedResource(resource, requestedId, "retired_model"),
      );
      skippedResourceIds.add(requestedId);
      continue;
    }

    selectedExplicitResources.set(requestedId, resource);
  }

  const dependencyCandidates = new Map<string, GraphResource>();
  if (options?.includeDependencies !== false) {
    for (const resource of selectedExplicitResources.values()) {
      collectDependencies(resourcesById, resource, dependencyCandidates);
    }

    // Auto-include connections referenced by selected largeLanguageModel resources.
    // The graph dependency tree may not link LLM → connection explicitly,
    // but an LLM without its connection is non-functional after import.
    for (const resource of selectedExplicitResources.values()) {
      if (resource.type !== "largeLanguageModel") continue;
      const connId =
        resource.properties?.connectionId ??
        (resource as any).connectionId ??
        undefined;
      if (!connId || selectedExplicitResources.has(connId)) continue;
      const connResource = resourcesById.get(connId);
      if (connResource && !dependencyCandidates.has(connId)) {
        dependencyCandidates.set(connId, connResource);
      }
    }
  }

  for (const selectedId of selectedExplicitResources.keys()) {
    dependencyCandidates.delete(selectedId);
  }

  const requestedDependencyIds = options?.dependencyResourceIds;
  const selectedDependencyResources = new Map<string, GraphResource>();
  const dependencyIdsToInclude =
    requestedDependencyIds && requestedDependencyIds.length > 0
      ? requestedDependencyIds
      : Array.from(dependencyCandidates.keys());

  for (const dependencyId of dependencyIdsToInclude) {
    const dependency = dependencyCandidates.get(dependencyId);
    if (!dependency) {
      skippedResources.push(
        buildExportSkippedResource(
          allResourcesById.get(dependencyId),
          dependencyId,
          "missing_from_graph",
        ),
      );
      skippedResourceIds.add(dependencyId);
      continue;
    }

    if (!isExportablePackageResource(dependency)) {
      skippedResources.push(
        buildExportSkippedResource(
          dependency,
          dependencyId,
          "unsupported_resource_type",
        ),
      );
      skippedResourceIds.add(dependencyId);
      continue;
    }

    const disabledReason = getExportDisabledReason(dependency);
    if (disabledReason === "function_export_not_supported") {
      skippedResources.push(
        buildExportSkippedResource(
          dependency,
          dependencyId,
          "function_export_not_supported",
        ),
      );
      skippedResourceIds.add(dependencyId);
      continue;
    }

    if (disabledReason === "retired_model") {
      skippedResources.push(
        buildExportSkippedResource(dependency, dependencyId, "retired_model"),
      );
      skippedResourceIds.add(dependencyId);
      continue;
    }

    selectedDependencyResources.set(dependencyId, dependency);
  }

  const selectedResources = Array.from(selectedExplicitResources.values()).map(
    (resource) =>
      buildExportSelection(resource, {
        selectedExplicitly: true,
        includedAsDependency: false,
      }),
  );
  const dependencyResources = Array.from(
    selectedDependencyResources.values(),
  ).map((resource) =>
    buildExportSelection(resource, {
      selectedExplicitly: false,
      includedAsDependency: true,
    }),
  );

  const resourceIds = [
    ...selectedResources.map((resource) => resource.id),
    ...dependencyResources.map((resource) => resource.id),
  ];

  if (resourceIds.length === 0) {
    const skippedReason =
      skippedResources.length > 0
        ? ` All requested resources were skipped: ${Array.from(
            new Set(skippedResources.map((resource) => resource.reason)),
          ).join(", ")}.`
        : "";
    throw new Error(
      `At least one exportable resource must be selected.${skippedReason}`,
    );
  }

  return {
    project: {
      id: projectId,
      name: projectGraph.name ?? null,
    },
    requestedResourceIds,
    resourceIds,
    selectedResources,
    dependencyResources,
    skippedResources: skippedResources.filter(
      (resource, index, all) =>
        !skippedResourceIds.has(resource.id) ||
        all.findIndex(
          (candidate) =>
            candidate.id === resource.id &&
            candidate.reason === resource.reason,
        ) === index,
    ),
    summary: {
      selectedResourceCount: selectedResources.length,
      dependencyResourceCount: dependencyResources.length,
      skippedResourceCount: skippedResources.length,
    },
  };
}

export function buildPackageExportablePreview(
  projectId: string,
  graph: Record<string, GraphSubgraph>,
): PackageExportablePreview {
  const projectGraph = graph[projectId];

  if (!projectGraph) {
    throw new Error(`Project graph not found for ${projectId}`);
  }

  const graphResources = Array.isArray(projectGraph.resources)
    ? projectGraph.resources
    : [];

  const resources = graphResources
    .filter(isExportablePackageResource)
    .sort((a, b) => {
      const typeCompare = (a.type || "").localeCompare(b.type || "");
      return typeCompare !== 0
        ? typeCompare
        : resourceName(a).localeCompare(resourceName(b));
    })
    .map((resource) => {
      const disabledReason = getExportDisabledReason(resource);

      return {
        id: resourceId(resource),
        type: resource.type || "unknown",
        name: resourceName(resource),
        ...(resource.referenceId ? { referenceId: resource.referenceId } : {}),
        canExport: !disabledReason,
        ...(disabledReason ? { disabledReason } : {}),
        dependencyCount: Array.isArray((resource as any)?.dependencies)
          ? (resource as any).dependencies.length
          : 0,
        ...(resource.type === "largeLanguageModel"
          ? {
              ...(resource.properties?.modelType
                ? { modelType: resource.properties.modelType }
                : {}),
              ...((resource.properties?.connectionId ??
                (resource as any).connectionId) != null
                ? {
                    connectionId:
                      resource.properties?.connectionId ??
                      (resource as any).connectionId,
                  }
                : {}),
            }
          : {}),
      };
    });

  const typeCounts = Array.from(
    resources
      .reduce((acc, resource) => {
        const current = acc.get(resource.type) ?? {
          type: resource.type,
          count: 0,
          exportableNowCount: 0,
        };
        current.count += 1;
        if (resource.canExport) current.exportableNowCount += 1;
        acc.set(resource.type, current);
        return acc;
      }, new Map<string, { type: string; count: number; exportableNowCount: number }>())
      .values(),
  );

  return {
    project: {
      id: projectId,
      name: projectGraph.name ?? null,
    },
    resources,
    summary: {
      resourceCount: resources.length,
      exportableNowCount: resources.filter((resource) => resource.canExport)
        .length,
      disabledResourceCount: resources.filter((resource) => !resource.canExport)
        .length,
      typeCounts,
    },
  };
}

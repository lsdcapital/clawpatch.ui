import type { QueryClient } from "@tanstack/react-query";

export const clawpatchQueryKeys = {
  appSettings: () => ["appSettings"] as const,
  repos: () => ["repos"] as const,
  repoDoctor: (repoId?: string | null) => ["repoDoctor", repoId] as const,
  repoConfig: (repoId?: string | null) => ["repoConfig", repoId] as const,
  repoSettings: (repoId?: string | null) => ["repoSettings", repoId] as const,
  features: (repoId?: string | null) => ["features", repoId] as const,
  allFeatures: () => ["features"] as const,
  findings: (repoId?: string | null) => ["findings", repoId] as const,
  allFindings: () => ["findings"] as const,
  findingWorkStatuses: (repoId?: string | null) => ["findingWorkStatuses", repoId] as const,
  allFindingWorkStatuses: () => ["findingWorkStatuses"] as const,
  finding: (repoId?: string | null, findingId?: string | null) =>
    ["finding", repoId, findingId] as const,
  allFindingDetails: () => ["finding"] as const,
  diff: (repoId?: string | null, findingId?: string | null) => ["diff", repoId, findingId] as const,
  repoDiffs: (repoId: string | null) => ["diff", repoId] as const,
  allDiffs: () => ["diff"] as const,
  gitStatus: (repoId?: string | null, findingId?: string | null) =>
    ["gitStatus", repoId, findingId] as const,
  repoGitStatuses: (repoId: string | null) => ["gitStatus", repoId] as const,
  allGitStatuses: () => ["gitStatus"] as const,
  registeredCheckoutStatus: (repoId?: string | null) =>
    ["gitStatus", repoId, "registeredCheckout"] as const,
};

export async function invalidateRepo(
  queryClient: QueryClient,
  repoId: string | null,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: clawpatchQueryKeys.repos() }),
    queryClient.invalidateQueries({ queryKey: clawpatchQueryKeys.features(repoId) }),
    queryClient.invalidateQueries({ queryKey: clawpatchQueryKeys.findings(repoId) }),
    queryClient.invalidateQueries({ queryKey: clawpatchQueryKeys.findingWorkStatuses(repoId) }),
    queryClient.invalidateQueries({ queryKey: clawpatchQueryKeys.allFindingDetails() }),
    queryClient.invalidateQueries({ queryKey: clawpatchQueryKeys.repoDiffs(repoId) }),
    queryClient.invalidateQueries({ queryKey: clawpatchQueryKeys.repoGitStatuses(repoId) }),
  ]);
}

export async function invalidateCommandProgress(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: clawpatchQueryKeys.repos() }),
    queryClient.invalidateQueries({ queryKey: clawpatchQueryKeys.allFeatures() }),
    queryClient.invalidateQueries({ queryKey: clawpatchQueryKeys.allFindings() }),
    queryClient.invalidateQueries({ queryKey: clawpatchQueryKeys.allFindingWorkStatuses() }),
    queryClient.invalidateQueries({ queryKey: clawpatchQueryKeys.allFindingDetails() }),
    queryClient.invalidateQueries({ queryKey: clawpatchQueryKeys.allDiffs() }),
    queryClient.invalidateQueries({ queryKey: clawpatchQueryKeys.allGitStatuses() }),
  ]);
}

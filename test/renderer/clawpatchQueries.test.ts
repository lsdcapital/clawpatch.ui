import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  clawpatchQueryKeys,
  invalidateCommandProgress,
  invalidateRepo,
} from "../../src/renderer/src/clawpatchQueries";

describe("clawpatch query helpers", () => {
  it("uses prefix keys when invalidating repo-scoped diff and status data", async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockImplementation(async () => undefined);

    await invalidateRepo(queryClient, "repo-auth");

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: clawpatchQueryKeys.repoDiffs("repo-auth"),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: clawpatchQueryKeys.repoGitStatuses("repo-auth"),
    });
  });

  it("keeps command progress invalidation scoped to Clawpatch state", async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockImplementation(async () => undefined);

    await invalidateCommandProgress(queryClient);

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: clawpatchQueryKeys.allFeatures(),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: clawpatchQueryKeys.allFindings(),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: clawpatchQueryKeys.allFindingDetails(),
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: clawpatchQueryKeys.repos(),
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: clawpatchQueryKeys.allDiffs(),
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: clawpatchQueryKeys.allGitStatuses(),
    });
  });
});

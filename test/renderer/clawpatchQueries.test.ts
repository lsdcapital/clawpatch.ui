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

  it("uses top-level prefixes when invalidating command progress", async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockImplementation(async () => undefined);

    await invalidateCommandProgress(queryClient);

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: clawpatchQueryKeys.allDiffs(),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: clawpatchQueryKeys.allGitStatuses(),
    });
  });
});

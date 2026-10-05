import { describe, expect, it } from "vitest";
import { analyzeGraph } from "../src/shared/domain/graph";
import { EXAMPLE_PROJECT } from "../src/shared/domain/types";
import {
  isSimulationReady,
  simulateProject,
} from "../src/shared/domain/simulation";
import {
  addRequestNode,
  toggleDependency,
} from "../src/features/graph-editor/graphViewModel";

describe("request dependency graph", () => {
  it("orders a DAG and detects a cycle before simulation", () => {
    const project = structuredClone(EXAMPLE_PROJECT);
    expect(analyzeGraph(project).order).toHaveLength(project.nodes.length);
    const cyclic = {
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === "session" ? { ...node, dependencyIds: ["profile"] } : node,
      ),
    };
    expect(analyzeGraph(cyclic).validation.errors.join(" ")).toContain(
      "循环依赖",
    );
    expect(simulateProject(cyclic).entries).toHaveLength(0);
  });

  it("rejects cyclic edges and accepts valid dependencies", () => {
    const project = {
      ...EXAMPLE_PROJECT,
      nodes: EXAMPLE_PROJECT.nodes.slice(0, 3),
    };
    const accepted = toggleDependency(project, "profile", "flags");
    expect(accepted.error).toBeUndefined();
    const rejected = toggleDependency(accepted.project, "flags", "profile");
    expect(rejected.error).toContain("循环");
    expect(rejected.project).toEqual(accepted.project);
  });

  it("schedules independent roots in parallel and serializes them at concurrency one", () => {
    const project = {
      ...EXAMPLE_PROJECT,
      nodes: EXAMPLE_PROJECT.nodes.slice(0, 2).map((node) => ({
        ...node,
        durationMs: 300,
        jitterMs: 0,
        timeoutMs: 1000,
        retryCount: 0,
        failureRate: 0,
      })),
    };
    const parallel = simulateProject(project);
    const serial = simulateProject({ ...project, concurrencyLimit: 1 });
    expect(parallel.completionMs).toBe(300);
    expect(serial.completionMs).toBe(600);
    expect(serial.entries[1]?.waitMs).toBe(300);
  });

  it("applies jitter modes, timeout caps, bounded retries, and fallback probability", () => {
    const node = {
      id: "a",
      name: "slow",
      durationMs: 1200,
      jitterMs: 400,
      dependencyIds: [],
      timeoutMs: 1000,
      retryCount: 1,
      failureRate: 50,
      fallbackNodeId: "b",
    };
    const fallback = {
      ...node,
      id: "b",
      name: "fallback",
      durationMs: 200,
      jitterMs: 0,
      timeoutMs: 500,
      retryCount: 0,
      failureRate: 0,
      fallbackNodeId: undefined,
    };
    const project = { ...EXAMPLE_PROJECT, nodes: [node, fallback] };
    const low = simulateProject(project, "low");
    const expected = simulateProject(project, "expected");
    const high = simulateProject(project, "high");
    expect(low.completionMs).toBeLessThanOrEqual(expected.completionMs);
    expect(expected.completionMs).toBeLessThanOrEqual(high.completionMs);
    expect(high.warnings.join(" ")).toContain("超时");
    expect(high.entries[0]?.modeledDurationMs).toBe(1650);
    const invalid = {
      ...project,
      nodes: [{ ...node, retryCount: 9 }, fallback],
    };
    expect(simulateProject(invalid).entries).toHaveLength(0);
  });

  it("creates an editable request node with safe defaults", () => {
    const project = { ...EXAMPLE_PROJECT, nodes: [] };
    const next = addRequestNode(project);
    expect(next.nodes).toHaveLength(1);
    expect(next.nodes[0]?.durationMs).toBe(400);
    expect(next.nodes[0]?.dependencyIds).toEqual([]);
  });

  it("separates blocking errors from warnings and keeps them out of the risk list", () => {
    const base = {
      ...EXAMPLE_PROJECT,
      nodes: EXAMPLE_PROJECT.nodes.slice(0, 2),
    };

    const emptyName = {
      ...base,
      nodes: base.nodes.map((node, index) =>
        index === 0 ? { ...node, name: "  " } : node,
      ),
    };
    const nameResult = simulateProject(emptyName);
    expect(nameResult.status).toBe("error");
    expect(isSimulationReady(nameResult)).toBe(false);
    expect(nameResult.entries).toHaveLength(0);
    expect(nameResult.errors.join(" ")).toContain("名称不能为空");
    expect(nameResult.warnings).toEqual([]);

    const outOfRange = {
      ...base,
      nodes: base.nodes.map((node, index) =>
        index === 0 ? { ...node, retryCount: 12 } : node,
      ),
    };
    const retryResult = simulateProject(outOfRange);
    expect(retryResult.status).toBe("error");
    expect(isSimulationReady(retryResult)).toBe(false);
    expect(retryResult.errors.join(" ")).toContain("重试次数");
    expect(retryResult.warnings).toEqual([]);

    const healthy = simulateProject(base);
    expect(healthy.status).toBe("ok");
    expect(healthy.errors).toEqual([]);
    expect(isSimulationReady(healthy)).toBe(true);
  });

  it("recovers normal results after the blocking configuration is repaired", () => {
    const base = {
      ...EXAMPLE_PROJECT,
      nodes: EXAMPLE_PROJECT.nodes.slice(0, 2).map((node) => ({
        ...node,
        jitterMs: 0,
        timeoutMs: 1000,
        retryCount: 0,
        failureRate: 0,
      })),
    };
    const broken = {
      ...base,
      nodes: base.nodes.map((node, index) =>
        index === 0 ? { ...node, name: "" } : node,
      ),
    };
    expect(simulateProject(broken).status).toBe("error");
    const repaired = {
      ...broken,
      nodes: broken.nodes.map((node, index) =>
        index === 0 ? { ...node, name: "会话校验" } : node,
      ),
    };
    const result = simulateProject(repaired);
    expect(result.status).toBe("ok");
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(2);
    expect(result.criticalPath.length).toBeGreaterThan(0);
    expect(result.completionMs).toBeGreaterThan(0);
  });

  it("keeps warnings informational without blocking the simulation", () => {
    const base = {
      ...EXAMPLE_PROJECT,
      nodes: EXAMPLE_PROJECT.nodes.slice(0, 2).map((node) => ({
        ...node,
        retryCount: 4,
      })),
    };
    const result = simulateProject(base);
    expect(result.status).toBe("ok");
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(" ")).toContain("重试次数较高");
    expect(isSimulationReady(result)).toBe(true);
  });
});

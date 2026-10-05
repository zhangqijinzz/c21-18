import { describe, expect, it } from "vitest";
import { analyzeGraph } from "../src/shared/domain/graph";
import { EXAMPLE_PROJECT } from "../src/shared/domain/types";
import {
  canSimulateProject,
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

  it("surfaces validation failures as errors separate from warnings", () => {
    const validNode = {
      ...EXAMPLE_PROJECT.nodes[0]!,
      id: "ok",
      name: "正常节点",
      retryCount: 1,
      dependencyIds: [],
      fallbackNodeId: undefined,
    };
    const brokenNode = {
      ...validNode,
      id: "broken",
      name: "   ",
      retryCount: 9,
    };
    const project = {
      ...EXAMPLE_PROJECT,
      nodes: [validNode, brokenNode],
    };
    const result = simulateProject(project);
    expect(result.errors.join(" ")).toContain("节点名称不能为空");
    expect(result.errors.join(" ")).toContain("重试次数需在 0–8 次");
    expect(result.entries).toHaveLength(0);
    expect(result.completionMs).toBe(0);
    expect(result.criticalPath).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(canSimulateProject(project)).toBe(false);
  });

  it("keeps warnings when the graph is otherwise runnable", () => {
    const project = {
      ...EXAMPLE_PROJECT,
      nodes: [
        {
          id: "root",
          name: "根节点",
          durationMs: 200,
          jitterMs: 0,
          dependencyIds: [],
          timeoutMs: 600,
          retryCount: 5,
          failureRate: 0,
        },
        {
          id: "leaf",
          name: "下游节点",
          durationMs: 100,
          jitterMs: 0,
          dependencyIds: ["root"],
          timeoutMs: 400,
          retryCount: 5,
          failureRate: 0,
        },
      ],
    };
    const result = simulateProject(project);
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(2);
    expect(result.warnings.join(" ")).toContain("重试次数较高");
    expect(canSimulateProject(project)).toBe(true);
  });

  it("does not warn about multiple entries for a single-entry chain", () => {
    const project = {
      ...EXAMPLE_PROJECT,
      nodes: [
        {
          id: "root",
          name: "根节点",
          durationMs: 100,
          jitterMs: 0,
          dependencyIds: [],
          timeoutMs: 400,
          retryCount: 0,
          failureRate: 0,
        },
        {
          id: "leaf",
          name: "下游节点",
          durationMs: 100,
          jitterMs: 0,
          dependencyIds: ["root"],
          timeoutMs: 400,
          retryCount: 0,
          failureRate: 0,
        },
      ],
    };
    expect(analyzeGraph(project).validation.warnings.join(" ")).not.toContain(
      "多个入口节点",
    );
  });

  it("rejects an empty project but resumes with a normal result after repair", () => {
    const empty = { ...EXAMPLE_PROJECT, nodes: [] };
    expect(canSimulateProject(empty)).toBe(false);
    expect(simulateProject(empty).completionMs).toBe(0);

    const brokenNode = {
      ...EXAMPLE_PROJECT.nodes[0]!,
      id: "a",
      name: "",
      retryCount: 9,
      dependencyIds: [],
      fallbackNodeId: undefined,
    };
    const broken = { ...EXAMPLE_PROJECT, nodes: [brokenNode] };
    expect(canSimulateProject(broken)).toBe(false);

    const repaired = {
      ...broken,
      nodes: [{ ...brokenNode, name: "已修复", retryCount: 2 }],
    };
    const repairedResult = simulateProject(repaired, "expected");
    expect(canSimulateProject(repaired)).toBe(true);
    expect(repairedResult.errors).toEqual([]);
    expect(repairedResult.entries).toHaveLength(1);
    expect(repairedResult.completionMs).toBeGreaterThan(0);
    expect(repairedResult.criticalPath).toEqual(["a"]);
  });
});

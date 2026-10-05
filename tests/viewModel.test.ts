import { describe, expect, it } from "vitest";
import {
  createProject,
  duplicateProject,
  selectProject,
} from "../src/features/projects/projectViewModel";
import {
  compareScenarios,
  restoreScenario,
  saveScenario,
} from "../src/features/scenarios/scenarioViewModel";
import {
  canSimulateProject,
  simulateProject,
} from "../src/shared/domain/simulation";
import { EXAMPLE_PROJECT } from "../src/shared/domain/types";

describe("project and scenario view models", () => {
  it("creates a project and switches the active project", () => {
    const initial = {
      version: 1 as const,
      activeProjectId: EXAMPLE_PROJECT.id,
      projects: [EXAMPLE_PROJECT],
    };
    const created = createProject(initial, 100);
    expect(created.projects).toHaveLength(2);
    expect(created.activeProjectId).not.toBe(EXAMPLE_PROJECT.id);
    expect(selectProject(created, EXAMPLE_PROJECT.id).activeProjectId).toBe(
      EXAMPLE_PROJECT.id,
    );
  });

  it("duplicates a project and remaps its dependency identities", () => {
    const initial = {
      version: 1 as const,
      activeProjectId: EXAMPLE_PROJECT.id,
      projects: [EXAMPLE_PROJECT],
    };
    const duplicated = duplicateProject(initial, EXAMPLE_PROJECT, 10);
    const copy = duplicated.projects[0];
    expect(copy?.nodes[2]?.dependencyIds).toEqual([copy?.nodes[0]?.id]);
    expect(copy?.nodes[4]?.fallbackNodeId).toBe(copy?.nodes[3]?.id);
    expect(copy?.id).not.toBe(EXAMPLE_PROJECT.id);
    expect(copy?.scenarios).toEqual([]);
  });

  it("saves a complete snapshot and restores its parameters", () => {
    const baseline = {
      ...EXAMPLE_PROJECT,
      nodes: EXAMPLE_PROJECT.nodes.slice(0, 2),
    };
    const result = simulateProject(baseline);
    const saved = saveScenario(baseline, result, "并发方案");
    expect(saved.scenarios).toHaveLength(1);
    const changed = {
      ...saved,
      nodes: saved.nodes.map((node) => ({ ...node, durationMs: 999 })),
    };
    const restored = restoreScenario(changed, saved.scenarios[0]?.id ?? "");
    expect(restored.nodes[0]?.durationMs).toBe(baseline.nodes[0]?.durationMs);
  });

  it("describes node and concurrency differences between snapshots", () => {
    const baseline = {
      ...EXAMPLE_PROJECT,
      nodes: EXAMPLE_PROJECT.nodes.slice(0, 2),
    };
    const baselineSnapshot = saveScenario(
      baseline,
      simulateProject(baseline),
      "不限并发",
    ).scenarios[0];
    const changed = {
      ...baseline,
      concurrencyLimit: 1,
      nodes: baseline.nodes.map((node, index) =>
        index === 0 ? { ...node, durationMs: 900 } : node,
      ),
    };
    const changedSnapshot = saveScenario(
      changed,
      simulateProject(changed),
      "串行优化",
    ).scenarios[0];
    if (!baselineSnapshot || !changedSnapshot)
      throw new Error("Scenario fixtures should be saved");
    const comparison = compareScenarios(baselineSnapshot, changedSnapshot);
    expect(comparison.deltaMs).toBeGreaterThan(0);
    expect(comparison.changes.join(" ")).toContain("并发上限");
    expect(comparison.changes.join(" ")).toContain("耗时");
  });

  it("refuses to snapshot empty or erroring projects with the same rule as simulation", () => {
    const empty = { ...EXAMPLE_PROJECT, nodes: [], scenarios: [] };
    const emptyResult = simulateProject(empty);
    expect(emptyResult.errors).toEqual([]);
    expect(canSimulateProject(empty)).toBe(false);
    expect(saveScenario(empty, emptyResult, "空链路")).toBe(empty);

    const broken = {
      ...EXAMPLE_PROJECT,
      scenarios: [],
      nodes: [
        {
          ...EXAMPLE_PROJECT.nodes[0]!,
          id: "bad",
          name: "  ",
          retryCount: 12,
          dependencyIds: [],
          fallbackNodeId: undefined,
        },
      ],
    };
    const brokenResult = simulateProject(broken);
    expect(brokenResult.errors.length).toBeGreaterThan(0);
    expect(canSimulateProject(broken)).toBe(false);
    expect(saveScenario(broken, brokenResult, "坏配置")).toBe(broken);
  });

  it("still snapshots a valid graph that only carries warnings", () => {
    const warned = {
      ...EXAMPLE_PROJECT,
      scenarios: [],
      nodes: EXAMPLE_PROJECT.nodes.slice(0, 2).map((node) => ({
        ...node,
        retryCount: 5,
      })),
    };
    const result = simulateProject(warned);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(" ")).toContain("重试次数较高");
    const saved = saveScenario(warned, result, "告警但可推演");
    expect(saved.scenarios).toHaveLength(1);
  });

  it("snapshots a repaired project with a usable completion budget", () => {
    const broken = {
      ...EXAMPLE_PROJECT,
      scenarios: [],
      nodes: [
        {
          ...EXAMPLE_PROJECT.nodes[0]!,
          id: "solo",
          name: "",
          retryCount: 9,
          dependencyIds: [],
          fallbackNodeId: undefined,
        },
      ],
    };
    expect(simulateProject(broken).completionMs).toBe(0);
    const repaired = {
      ...broken,
      nodes: [{ ...broken.nodes[0]!, name: "恢复正常", retryCount: 1 }],
    };
    const result = simulateProject(repaired);
    expect(result.errors).toEqual([]);
    const saved = saveScenario(repaired, result, "修复后方案");
    expect(saved.scenarios[0]?.completionMs).toBeGreaterThan(0);
    expect(saved.scenarios[0]?.criticalPath).toEqual(["solo"]);
  });
});

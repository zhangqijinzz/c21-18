import {
  Activity,
  ArrowDownUp,
  CircleHelp,
  CircleX,
  Gauge,
  Play,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import type {
  LatencyProject,
  SimulationMode,
  SimulationResult,
} from "../../shared/domain/types";
import Timeline from "./Timeline";

interface Props {
  project: LatencyProject;
  result: SimulationResult;
  mode: SimulationMode;
  onMode: (mode: SimulationMode) => void;
  onConcurrency: (limit: number | null) => void;
  onRun: () => void;
}

const modes: { id: SimulationMode; label: string; sub: string }[] = [
  { id: "low", label: "乐观", sub: "低波动" },
  { id: "expected", label: "预期", sub: "中位估算" },
  { id: "high", label: "保守", sub: "高波动" },
];

function durationLabel(value: number): string {
  return value < 1000
    ? `${Math.round(value)} ms`
    : `${(value / 1000).toFixed(2)} s`;
}

export default function SimulationPanel({
  project,
  result,
  mode,
  onMode,
  onConcurrency,
  onRun,
}: Props) {
  const hasErrors = result.errors.length > 0;
  const isEmpty = !hasErrors && project.nodes.length === 0;
  const criticalNames = result.criticalPath
    .map((id) => project.nodes.find((node) => node.id === id)?.name)
    .filter(Boolean);
  const modeLabel =
    mode === "low" ? "低波动情境" : mode === "high" ? "高波动情境" : "预期情境";
  return (
    <section className="module-page simulation-page">
      <div className="module-heading">
        <div>
          <span className="eyebrow">03 / SIMULATION</span>
          <h1>时序推演</h1>
          <p>估算请求完成时间，找出预算被消耗在了哪里。</p>
        </div>
        <button
          className={`button button-primary ${hasErrors ? "button-has-error" : ""}`}
          onClick={onRun}
        >
          {hasErrors ? (
            <CircleX size={15} />
          ) : (
            <Play size={15} fill="currentColor" />
          )}
          {hasErrors ? "配置错误，无法推演" : "运行推演"}
        </button>
      </div>
      <div className="simulation-toolbar">
        <div className="mode-control">
          <span className="toolbar-label">预算假设</span>
          <div className="segmented-control">
            {modes.map((item) => (
              <button
                key={item.id}
                className={mode === item.id ? "selected" : ""}
                onClick={() => onMode(item.id)}
              >
                <b>{item.label}</b>
                <small>{item.sub}</small>
              </button>
            ))}
          </div>
        </div>
        <label className="concurrency-control">
          <span className="toolbar-label">最大并发</span>
          <span className="select-wrap">
            <ArrowDownUp size={14} />
            <select
              value={project.concurrencyLimit ?? "all"}
              onChange={(event) =>
                onConcurrency(
                  event.target.value === "all"
                    ? null
                    : Number(event.target.value),
                )
              }
            >
              <option value="all">不限</option>
              {[1, 2, 3, 4, 5, 8].map((value) => (
                <option key={value} value={value}>
                  {value} 路并发
                </option>
              ))}
            </select>
          </span>
        </label>
        <div className="model-note">
          <CircleHelp size={14} /> 确定性估算，不发送真实请求
        </div>
      </div>
      <div className={`metric-grid ${hasErrors ? "has-error" : ""}`}>
        <article className="metric-card metric-primary">
          <span>
            页面完成预算 <Activity size={16} />
          </span>
          <strong>
            {hasErrors || isEmpty ? "—" : durationLabel(result.completionMs)}
          </strong>
          <small>
            {hasErrors
              ? "链路配置存在错误，完成预算不可用"
              : isEmpty
                ? "添加请求节点后开始推演"
                : `${modeLabel} · ${project.nodes.length} 个请求`}
          </small>
          <div className="metric-spark">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </article>
        <article className="metric-card">
          <span>
            关键链路长度 <Gauge size={16} />
          </span>
          <strong>
            {hasErrors || isEmpty ? "—" : criticalNames.length}{" "}
            {!hasErrors && !isEmpty && <small>nodes</small>}
          </strong>
          <div className="critical-chips">
            {hasErrors ? (
              <span className="chip-error">配置错误，关键链路不可用</span>
            ) : isEmpty ? (
              <span>等待输入节点</span>
            ) : criticalNames.length ? (
              criticalNames.map((name) => <em key={name}>{name}</em>)
            ) : (
              <span>未形成关键路径</span>
            )}
          </div>
        </article>
        <article className={`metric-card ${hasErrors ? "metric-danger" : ""}`}>
          <span>
            {hasErrors ? "配置错误" : "风险提示"}
            {hasErrors ? <CircleX size={16} /> : <ShieldAlert size={16} />}
          </span>
          <strong>
            {hasErrors ? result.errors.length : result.warnings.length}{" "}
            <small>items</small>
          </strong>
          <div className="risk-copy">
            {hasErrors
              ? "先修复下列配置错误，推演结果才可用"
              : (result.warnings[0] ?? "当前参数范围内未发现明显风险")}
          </div>
        </article>
      </div>
      {hasErrors && (
        <div className="simulation-errors" role="alert">
          <div className="simulation-issues-head">
            <CircleX size={14} />
            <strong>推演中止：{result.errors.length} 项配置错误</strong>
          </div>
          <ul>
            {result.errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}
      {!hasErrors && result.warnings.length > 0 && (
        <div className="simulation-warnings">
          <div className="simulation-issues-head">
            <TriangleAlert size={14} />
            <strong>{result.warnings.length} 项风险提示</strong>
          </div>
          <ul>
            {result.warnings.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}
      <Timeline project={project} result={result} />
      <div className="model-footnote">
        耗时 = 截断后的请求耗时 × 失败重试概率 +
        指数退避；降级开销按最终失败概率加权。并发上限会计入资源排队。
      </div>
    </section>
  );
}

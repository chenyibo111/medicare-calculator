"use client";

import type { CalculationResponse } from "../../../packages/contracts/src/calculation-contract";

function displayFen(value: number) {
  const yuan = Math.floor(value / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `¥${yuan}.${(value % 100).toString().padStart(2, "0")}`;
}

export function CalculationResult({ response, totalAmountFen }: { response: CalculationResponse | null; totalAmountFen: number }) {
  if (!response) {
    return <section className="service-result" aria-labelledby="service-result-title"><p className="service-eyebrow">服务端结算单</p><h2 id="service-result-title">等待测算</h2><p className="service-muted">提交条件后，页面只渲染 API 返回的金额、计算轨迹和政策版本。</p></section>;
  }
  const { result } = response;
  return (
    <section className="service-result" aria-labelledby="service-result-title">
      <p className="service-eyebrow">服务端结算单</p><h2 id="service-result-title">预计结算结果</h2>
      <div className="service-settlement"><div><p>预计自费</p><output data-testid="service-estimated-self-pay">{displayFen(result.estimatedSelfPayFen)}</output></div><dl><div><dt>政策版本</dt><dd>{response.policyVersion}</dd></div><div><dt>执行方式</dt><dd>服务器计算</dd></div><div><dt>缓存状态</dt><dd>{response.cacheStatus === "hit" ? "命中" : "未命中"}</dd></div><div><dt>请求标识</dt><dd>{response.calculationId}</dd></div></dl></div>
      <dl className="service-amounts"><div><dt>总医疗费用</dt><dd>{displayFen(totalAmountFen)}</dd></div><div><dt>基本医保报销</dt><dd>{displayFen(result.basicReimbursementFen)}</dd></div><div><dt>大病保险报销</dt><dd>{displayFen(result.catastrophicReimbursementFen)}</dd></div></dl>
      <details className="service-trace" open><summary>计算明细 <span>来自 API</span></summary><ol>{response.trace.map((step) => <li key={step.code}><span>{step.label}{step.note ? ` · ${step.note}` : ""}</span><strong>{step.valueFen === undefined ? `${((step.valueBps ?? 0) / 100).toFixed(2)}%` : displayFen(step.valueFen)}</strong></li>)}</ol></details>
    </section>
  );
}

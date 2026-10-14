"use client";

import { FormEvent, useMemo, useState } from "react";
import type { CalculationResponse } from "../../../packages/contracts/src/calculation-contract";
import { CalculationResult } from "./calculation-result";

type Fields = { region: "城市A" | "城市B"; employmentStatus: "employed" | "retired" | "resident"; hospitalLevel: "community" | "secondary" | "tertiary"; totalAmount: string; outOfCatalogAmount: string; classBAmount: string; annualReimbursedAmount: string; outOfAreaFiled: boolean };
const cityASample: Fields = { region: "城市A", employmentStatus: "employed", hospitalLevel: "tertiary", totalAmount: "100000", outOfCatalogAmount: "5000", classBAmount: "10000", annualReimbursedAmount: "0", outOfAreaFiled: true };
const cityBSample: Fields = { region: "城市B", employmentStatus: "resident", hospitalLevel: "tertiary", totalAmount: "60000", outOfCatalogAmount: "2000", classBAmount: "10000", annualReimbursedAmount: "0", outOfAreaFiled: true };
const moneyFields = ["totalAmount", "outOfCatalogAmount", "classBAmount", "annualReimbursedAmount"] as const;

function yuanToFen(value: string): number | null { if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null; const [yuan, fen = ""] = value.trim().split("."); return Number(yuan) * 100 + Number(fen.padEnd(2, "0")); }

export function CalculationForm() {
  const [fields, setFields] = useState<Fields>(cityASample);
  const [response, setResponse] = useState<CalculationResponse | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const employmentOptions = useMemo(() => fields.region === "城市A" ? [{ value: "employed", label: "在职职工" }, { value: "retired", label: "退休人员" }] : [{ value: "resident", label: "居民医保" }], [fields.region]);
  const update = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((current) => ({ ...current, [key]: value }));
  const useSample = (sample: Fields) => { setFields(sample); setError(""); setResponse(null); };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setResponse(null);
    const amounts = Object.fromEntries(moneyFields.map((field) => [field, yuanToFen(fields[field])])) as Record<(typeof moneyFields)[number], number | null>;
    if (moneyFields.some((field) => amounts[field] === null)) { setError("金额请输入非负数字，最多保留两位小数。"); return; }
    setPending(true);
    try {
      const response = await fetch("/api/v1/reimbursement-calculations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ region: fields.region, employmentStatus: fields.employmentStatus, hospitalLevel: fields.hospitalLevel, totalAmountFen: amounts.totalAmount, outOfCatalogAmountFen: amounts.outOfCatalogAmount, classBAmountFen: amounts.classBAmount, annualReimbursedAmountFen: amounts.annualReimbursedAmount, outOfAreaFiled: fields.outOfAreaFiled }) });
      const payload = await response.json();
      if (!response.ok) { setError(typeof payload.message === "string" ? payload.message : "服务暂时无法完成测算，请检查输入后重试。"); return; }
      setResponse(payload as CalculationResponse);
    } catch { setError("网络连接异常，请稍后重试。输入条件已保留。"); } finally { setPending(false); }
  }
  return <div className="service-grid"><form className="service-form" noValidate onSubmit={submit}>
    <p className="service-eyebrow">输入条件</p><h2>住院费用测算</h2><p className="service-muted">金额以元填写；浏览器只负责构造请求，不保存政策规则。</p>
    <div className="service-samples"><span>快速体验</span><button type="button" onClick={() => useSample(cityASample)}>填入城市 A 样例</button><button type="button" data-testid="service-sample-city-b" onClick={() => useSample(cityBSample)}>填入城市 B 样例</button></div>
    <div className="service-fields">
      <label>参保城市<select aria-label="参保城市" value={fields.region} onChange={(event) => { const value = event.target.value as Fields["region"]; update("region", value); update("employmentStatus", value === "城市A" ? "employed" : "resident"); }}><option value="城市A">城市 A · 职工医保</option><option value="城市B">城市 B · 居民医保</option></select></label>
      <label>参保身份<select aria-label="参保身份" value={fields.employmentStatus} onChange={(event) => update("employmentStatus", event.target.value as Fields["employmentStatus"])}>{employmentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label>医院等级<select aria-label="医院等级" value={fields.hospitalLevel} onChange={(event) => update("hospitalLevel", event.target.value as Fields["hospitalLevel"])}><option value="community">社区医院</option><option value="secondary">二级医院</option><option value="tertiary">三级医院</option></select></label>
      <label className="service-checkbox"><input type="checkbox" checked={fields.outOfAreaFiled} onChange={(event) => update("outOfAreaFiled", event.target.checked)} />异地就医已备案<span>未备案的处理由服务端政策决定。</span></label>
      <label>总医疗费用（元）<input aria-label="总医疗费用（元）" inputMode="decimal" value={fields.totalAmount} onChange={(event) => update("totalAmount", event.target.value)} /></label>
      <label>目录外费用（元）<input inputMode="decimal" value={fields.outOfCatalogAmount} onChange={(event) => update("outOfCatalogAmount", event.target.value)} /></label>
      <label>乙类费用（元）<input inputMode="decimal" value={fields.classBAmount} onChange={(event) => update("classBAmount", event.target.value)} /></label>
      <label>本年度已报销（元）<input inputMode="decimal" value={fields.annualReimbursedAmount} onChange={(event) => update("annualReimbursedAmount", event.target.value)} /></label>
    </div>
    {error && <p className="service-error" data-testid="service-error" role="alert">{error}</p>}<button className="service-submit" type="submit" disabled={pending}>{pending ? "正在测算" : "开始测算"}</button>
  </form><CalculationResult response={response} totalAmountFen={yuanToFen(fields.totalAmount) ?? 0} /></div>;
}

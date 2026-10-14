"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import type { CalculationResponse } from "../../../packages/contracts/src/calculation-contract";
import { CalculationResult } from "./calculation-result";

type Fields = { region: "城市A" | "城市B"; employmentStatus: "employed" | "retired" | "resident"; hospitalLevel: "community" | "secondary" | "tertiary"; totalAmount: string; outOfCatalogAmount: string; classBAmount: string; annualReimbursedAmount: string; outOfAreaFiled: boolean };
const cityASample: Fields = { region: "城市A", employmentStatus: "employed", hospitalLevel: "tertiary", totalAmount: "100000", outOfCatalogAmount: "5000", classBAmount: "10000", annualReimbursedAmount: "0", outOfAreaFiled: true };
const cityBSample: Fields = { region: "城市B", employmentStatus: "resident", hospitalLevel: "tertiary", totalAmount: "60000", outOfCatalogAmount: "2000", classBAmount: "10000", annualReimbursedAmount: "0", outOfAreaFiled: true };
const moneyFields = ["totalAmount", "outOfCatalogAmount", "classBAmount", "annualReimbursedAmount"] as const;
type MoneyField = (typeof moneyFields)[number];

function yuanToFen(value: string): number | null { if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null; const [yuan, fen = ""] = value.trim().split("."); return Number(yuan) * 100 + Number(fen.padEnd(2, "0")); }

export function CalculationForm() {
  const [fields, setFields] = useState<Fields>(cityASample);
  const [response, setResponse] = useState<CalculationResponse | null>(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<MoneyField, string>>>({});
  const [pending, setPending] = useState(false);
  const moneyRefs = { totalAmount: useRef<HTMLInputElement>(null), outOfCatalogAmount: useRef<HTMLInputElement>(null), classBAmount: useRef<HTMLInputElement>(null), annualReimbursedAmount: useRef<HTMLInputElement>(null) };
  const employmentOptions = useMemo(() => fields.region === "城市A" ? [{ value: "employed", label: "在职职工" }, { value: "retired", label: "退休人员" }] : [{ value: "resident", label: "居民医保" }], [fields.region]);
  const update = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((current) => ({ ...current, [key]: value }));
  const useSample = (sample: Fields) => { setFields(sample); setError(""); setFieldErrors({}); setResponse(null); };
  const focusField = (field: MoneyField) => requestAnimationFrame(() => moneyRefs[field].current?.focus());
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setFieldErrors({}); setResponse(null);
    const amounts = Object.fromEntries(moneyFields.map((field) => [field, yuanToFen(fields[field])])) as Record<(typeof moneyFields)[number], number | null>;
    const firstInvalid = moneyFields.find((field) => amounts[field] === null);
    if (firstInvalid) { setFieldErrors({ [firstInvalid]: "请输入非负数字，最多保留两位小数。" }); focusField(firstInvalid); return; }
    setPending(true);
    try {
      const response = await fetch("/api/v1/reimbursement-calculations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ region: fields.region, employmentStatus: fields.employmentStatus, hospitalLevel: fields.hospitalLevel, totalAmountFen: amounts.totalAmount, outOfCatalogAmountFen: amounts.outOfCatalogAmount, classBAmountFen: amounts.classBAmount, annualReimbursedAmountFen: amounts.annualReimbursedAmount, outOfAreaFiled: fields.outOfAreaFiled }) });
      const payload = await response.json();
      if (!response.ok) {
        const message = typeof payload.message === "string" ? payload.message : "服务暂时无法完成测算，请检查输入后重试。";
        const field = message.includes("目录外") ? "outOfCatalogAmount" : message.includes("乙类") ? "classBAmount" : message.includes("年度") ? "annualReimbursedAmount" : message.includes("总医疗") || message.includes("总费用") ? "totalAmount" : undefined;
        if (field) { setFieldErrors({ [field]: message }); focusField(field); } else setError(message);
        return;
      }
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
      <label>总医疗费用（元）<input ref={moneyRefs.totalAmount} aria-label="总医疗费用（元）" aria-invalid={Boolean(fieldErrors.totalAmount)} aria-describedby="totalAmount-error" inputMode="decimal" value={fields.totalAmount} onChange={(event) => update("totalAmount", event.target.value)} /><span id="totalAmount-error" data-testid="totalAmount-error" className="service-field-error" role="alert">{fieldErrors.totalAmount}</span></label>
      <label>目录外费用（元）<input ref={moneyRefs.outOfCatalogAmount} aria-invalid={Boolean(fieldErrors.outOfCatalogAmount)} aria-describedby="outOfCatalogAmount-error" inputMode="decimal" value={fields.outOfCatalogAmount} onChange={(event) => update("outOfCatalogAmount", event.target.value)} /><span id="outOfCatalogAmount-error" className="service-field-error" role="alert">{fieldErrors.outOfCatalogAmount}</span></label>
      <label>乙类费用（元）<input ref={moneyRefs.classBAmount} aria-invalid={Boolean(fieldErrors.classBAmount)} aria-describedby="classBAmount-error" inputMode="decimal" value={fields.classBAmount} onChange={(event) => update("classBAmount", event.target.value)} /><span id="classBAmount-error" className="service-field-error" role="alert">{fieldErrors.classBAmount}</span></label>
      <label>本年度已报销（元）<input ref={moneyRefs.annualReimbursedAmount} aria-invalid={Boolean(fieldErrors.annualReimbursedAmount)} aria-describedby="annualReimbursedAmount-error" inputMode="decimal" value={fields.annualReimbursedAmount} onChange={(event) => update("annualReimbursedAmount", event.target.value)} /><span id="annualReimbursedAmount-error" className="service-field-error" role="alert">{fieldErrors.annualReimbursedAmount}</span></label>
    </div>
    {error && <p className="service-error" data-testid="service-error" role="alert">{error}</p>}<button className="service-submit" type="submit" disabled={pending}>{pending ? "正在测算" : "开始测算"}</button>
  </form><CalculationResult response={response} totalAmountFen={yuanToFen(fields.totalAmount) ?? 0} /></div>;
}

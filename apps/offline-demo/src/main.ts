import { formatFen, yuanToFen } from "../../../packages/domain/src/money";
import { ReimbursementEngine } from "../../../packages/domain/src/reimbursement-engine";
import type { EmploymentStatus, HospitalLevel, ValidatedCalculationInput } from "../../../packages/domain/src/policy";
import { offlinePolicies } from "./policy-snapshot";

declare global { interface Window { medicareOfflineAction?: (action: "calculator" | "architecture" | keyof typeof samples) => void; } }

const engine = new ReimbursementEngine();
const form = document.querySelector<HTMLFormElement>("#calculator-form")!;
const region = document.querySelector<HTMLSelectElement>("#region")!;
const employmentStatus = document.querySelector<HTMLSelectElement>("#employmentStatus")!;
const hospitalLevel = document.querySelector<HTMLSelectElement>("#hospitalLevel")!;
const outOfAreaFiled = document.querySelector<HTMLInputElement>("#outOfAreaFiled")!;
const status = document.querySelector<HTMLElement>("#form-status")!;
const resultContent = document.querySelector<HTMLElement>("#result-content")!;
const resultPlaceholder = document.querySelector<HTMLElement>("#result-placeholder")!;
const moneyInputs = ["totalAmount", "outOfCatalogAmount", "classBAmount", "annualReimbursedAmount"] as const;
type MoneyField = (typeof moneyInputs)[number];

const samples = {
  "city-a": { region: "城市A", employmentStatus: "employed", hospitalLevel: "tertiary", totalAmount: "100000", outOfCatalogAmount: "5000", classBAmount: "10000", annualReimbursedAmount: "0", outOfAreaFiled: true },
  "city-b": { region: "城市B", employmentStatus: "resident", hospitalLevel: "tertiary", totalAmount: "60000", outOfCatalogAmount: "2000", classBAmount: "10000", annualReimbursedAmount: "0", outOfAreaFiled: true },
} as const;

function input(name: MoneyField) { return document.querySelector<HTMLInputElement>(`#${name}`)!; }
function displayFen(value: number) {
  const [yuan, fen] = formatFen(value).slice(1).split(".");
  return `¥${yuan.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fen}`;
}
function setEmploymentOptions() {
  const options = region.value === "城市A" ? [{ value: "employed", label: "在职职工" }, { value: "retired", label: "退休人员" }] : [{ value: "resident", label: "居民医保" }];
  const current = employmentStatus.value;
  employmentStatus.replaceChildren(...options.map((option) => new Option(option.label, option.value)));
  employmentStatus.value = options.some((option) => option.value === current) ? current : options[0].value;
}
function clearErrors() {
  moneyInputs.forEach((name) => { input(name).removeAttribute("aria-invalid"); document.querySelector<HTMLElement>(`#${name}-error`)!.textContent = ""; });
  status.textContent = "";
}
function setError(name: MoneyField, message: string) { input(name).setAttribute("aria-invalid", "true"); document.querySelector<HTMLElement>(`#${name}-error`)!.textContent = message; }
function parseMoney(name: MoneyField): number | null {
  const value = input(name).value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) { setError(name, value.startsWith("-") ? "请输入不小于 0 的金额" : "请输入最多两位小数的金额"); return null; }
  return yuanToFen(value);
}
function toRequest(): ValidatedCalculationInput | null {
  clearErrors();
  const values = Object.fromEntries(moneyInputs.map((name) => [name, parseMoney(name)])) as Record<MoneyField, number | null>;
  const firstInvalid = moneyInputs.find((name) => values[name] === null);
  if (firstInvalid) { input(firstInvalid).focus(); return null; }
  if (values.outOfCatalogAmount! > values.totalAmount!) { setError("outOfCatalogAmount", "目录外费用不能超过总医疗费用"); input("outOfCatalogAmount").focus(); return null; }
  if (values.classBAmount! > values.totalAmount!) { setError("classBAmount", "乙类费用不能超过总医疗费用"); input("classBAmount").focus(); return null; }
  return { region: region.value, hospitalLevel: hospitalLevel.value as HospitalLevel, employmentStatus: employmentStatus.value as EmploymentStatus, totalAmountFen: values.totalAmount!, outOfCatalogAmountFen: values.outOfCatalogAmount!, classBAmountFen: values.classBAmount!, annualReimbursedAmountFen: values.annualReimbursedAmount!, outOfAreaFiled: outOfAreaFiled.checked };
}
function renderResult(request: ValidatedCalculationInput) {
  const policy = offlinePolicies[request.region];
  const result = engine.calculate(policy, request);
  resultPlaceholder.hidden = true; resultContent.hidden = false;
  document.querySelector<HTMLOutputElement>("#estimated-self-pay")!.value = displayFen(result.estimatedSelfPayFen);
  document.querySelector<HTMLElement>("#policy-version")!.textContent = policy.version;
  document.querySelector<HTMLElement>("#total-amount-output")!.textContent = displayFen(request.totalAmountFen);
  document.querySelector<HTMLElement>("#basic-reimbursement")!.textContent = displayFen(result.basicReimbursementFen);
  document.querySelector<HTMLElement>("#catastrophic-reimbursement")!.textContent = displayFen(result.catastrophicReimbursementFen);
  const trace = document.querySelector<HTMLOListElement>("#trace-list")!;
  trace.replaceChildren(...result.trace.map((step) => { const item = document.createElement("li"); const value = step.valueFen === undefined ? `${((step.valueBps ?? 0) / 100).toFixed(2)}%` : displayFen(step.valueFen); item.innerHTML = `<span>${step.label}${step.note ? ` · ${step.note}` : ""}</span><strong>${value}</strong>`; return item; }));
  status.textContent = "已完成本地示例测算，可展开核查计算明细。";
}
function fillSample(sampleName: keyof typeof samples) {
  const sample = samples[sampleName]; region.value = sample.region; setEmploymentOptions(); employmentStatus.value = sample.employmentStatus; hospitalLevel.value = sample.hospitalLevel; outOfAreaFiled.checked = sample.outOfAreaFiled;
  moneyInputs.forEach((name) => { input(name).value = sample[name]; }); clearErrors(); status.textContent = `已填入${sample.region}住院样例。`;
}
function activateTab(target: "calculator" | "architecture") {
  const calculator = target === "calculator";
  for (const [id, active] of [["calculator", calculator], ["architecture", !calculator]] as const) { const tab = document.querySelector<HTMLButtonElement>(`#${id}-tab`)!; tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1; }
  document.querySelector<HTMLElement>("#calculator-panel")!.hidden = !calculator; document.querySelector<HTMLElement>("#architecture-panel")!.hidden = calculator;
}
region.addEventListener("change", setEmploymentOptions);
window.medicareOfflineAction = (action) => { if (action === "calculator" || action === "architecture") activateTab(action); else fillSample(action); };
form.addEventListener("submit", (event) => { event.preventDefault(); const request = toRequest(); if (request) renderResult(request); });
setEmploymentOptions(); fillSample("city-a");

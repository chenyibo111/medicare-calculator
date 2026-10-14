import type { Metadata } from "next";
import { ArchitectureView } from "../components/architecture-view";
import { CalculationForm } from "../components/calculation-form";

export const metadata: Metadata = { title: "医保报销计算器 — 服务版" };

export default function HomePage() {
  return (
    <main className="service-shell">
      <header className="service-masthead">
        <div>
          <p className="service-eyebrow">企业 AI 实践 · 服务版</p>
          <h1>医保报销计算器</h1>
          <p className="service-lede">前端只提交条件；政策匹配、缓存读取与报销规则均在服务端统一执行。</p>
        </div>
        <aside className="service-notice"><strong>示例政策，仅供演示</strong><span>本服务使用本地示例政策与内存缓存，不连接真实医保系统。</span></aside>
      </header>
      <CalculationForm />
      <ArchitectureView />
    </main>
  );
}

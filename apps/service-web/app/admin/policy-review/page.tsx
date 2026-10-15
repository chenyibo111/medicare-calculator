import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PolicyReviewConsole } from "../../../components/policy-review-console";
import { resolveAdminConsoleConfig } from "../../../server/admin-console";

export const metadata: Metadata = { title: "本地评测后台 — 政策审核与发布" };
export const dynamic = "force-dynamic";

export default function PolicyReviewPage() {
  if (!resolveAdminConsoleConfig(process.env).enabled) notFound();
  return <main className="service-shell"><PolicyReviewConsole /></main>;
}

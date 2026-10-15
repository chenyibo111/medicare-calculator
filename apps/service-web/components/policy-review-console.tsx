"use client";

import { useCallback, useEffect, useState } from "react";

type Status = "draft" | "pending_review" | "approved" | "rejected" | "published";
type Operator = { id: string; displayName: string; roles: string[] };
type Draft = { id: string; status: Status; source: { region: string; sourceUrl: string }; policy: { benefitPlan: string; version: string; effectiveFrom: string }; submittedBy: string | null; submittedAt: string | null; review: { reviewerId: string; decision: string; reason: string | null; reviewedAt: string } | null };

const label: Record<Status, string> = { draft: "草稿", pending_review: "待审核", approved: "已批准", rejected: "已拒绝", published: "已发布" };

export function PolicyReviewConsole() {
  const [operator, setOperator] = useState<Operator | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("规则字段与来源已核对");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const session = await fetch("/api/v1/admin/session");
      if (session.ok) setOperator((await session.json()).operator as Operator); else setOperator(null);
      const response = await fetch("/api/v1/admin/policy-drafts");
      if (response.ok) setDrafts((await response.json()).drafts as Draft[]); else if (response.status !== 401) setMessage((await response.json()).message ?? "无法读取草稿列表。");
    } catch { setMessage("无法连接本地评测后台，请确认 Compose 服务已启动并开启后台开关。"); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function chooseSession(value: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/admin/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: value }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      setOperator(body.operator as Operator); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "身份切换失败。"); } finally { setBusy(false); }
  }
  async function command(path: string, body?: object) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message);
      setMessage(`操作完成：${payload.draft?.policy?.version ?? "草稿状态已更新"}`); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败，请刷新后重试。"); } finally { setBusy(false); }
  }
  const isAuthor = operator?.roles.includes("policy_author") ?? false;
  const isReviewer = operator?.roles.includes("policy_reviewer") ?? false;
  return <section className="review-console" aria-busy={loading || busy}>
    <header className="review-masthead"><div><p className="service-eyebrow">Local evaluation only</p><h1>政策审核与发布</h1><p className="service-lede">用固定 Compose 验收模板演示草稿、异人审核、事务发布与 Outbox 的完整边界。</p></div><aside className="review-warning"><strong>本地评测后台</strong><span>演示身份仅用于评测，生产必须由 OperatorIdentityProvider 接入企业 SSO/OAuth。</span></aside></header>
    <section className="review-identity" aria-label="当前本地评测身份"><div><span>当前身份</span><strong>{operator?.displayName ?? "尚未选择"}</strong><small>{operator ? operator.roles.join(" · ") : "请选择录入员或审核员"}</small></div><label>切换演示身份<select aria-label="切换本地评测身份" value={operator?.roles.includes("policy_author") ? "policy-author" : operator ? "policy-reviewer" : ""} disabled={busy} onChange={(event) => void chooseSession(event.target.value)}><option value="" disabled>请选择</option><option value="policy-author">本地政策录入员</option><option value="policy-reviewer">本地政策审核员</option></select></label></section>
    {message && <p className="review-message" role="status">{message}</p>}
    <section className="review-toolbar"><div><p className="service-eyebrow">受控模板</p><h2>政策草稿</h2><p className="service-muted">第一期不开放自由规则编辑；每次创建都会生成一份独立的固定验收草稿。</p></div>{isAuthor && <div className="review-actions"><button disabled={busy} onClick={() => void command("/api/v1/admin/policy-drafts", { templateVersion: "v1" })}>创建 Compose v1 草稿</button><button disabled={busy} className="review-outline" onClick={() => void command("/api/v1/admin/policy-drafts", { templateVersion: "v2" })}>创建 Compose v2 草稿</button></div>}</section>
    {loading ? <p className="service-muted">正在读取持久化草稿…</p> : drafts.length === 0 ? <p className="review-empty">尚无草稿。请以“本地政策录入员”身份创建一份固定 Compose 验收草稿。</p> : <div className="review-list">{drafts.map((draft) => <article className="review-card" key={draft.id}><div className="review-card-head"><div><p className="service-eyebrow">{draft.source.region} · {draft.policy.benefitPlan}</p><h2>{draft.policy.version}</h2></div><span className={`review-status status-${draft.status}`}>{label[draft.status]}</span></div><dl><div><dt>生效日期</dt><dd>{draft.policy.effectiveFrom}</dd></div><div><dt>提交人</dt><dd>{draft.submittedBy ?? "未提交"}</dd></div><div><dt>审核记录</dt><dd>{draft.review ? `${draft.review.reviewerId} · ${draft.review.decision}` : "尚未审核"}</dd></div></dl><a href={draft.source.sourceUrl} target="_blank" rel="noreferrer">查看受控来源</a>{draft.review?.reason && <p className="review-reason">审核意见：{draft.review.reason}</p>}<div className="review-card-actions">{isAuthor && draft.status === "draft" && <button disabled={busy} onClick={() => void command(`/api/v1/admin/policy-drafts/${draft.id}/submit`)}>提交审核</button>}{isReviewer && draft.status === "pending_review" && <><label>审核意见<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label><button disabled={busy} onClick={() => void command(`/api/v1/admin/policy-drafts/${draft.id}/review`, { decision: "approved", reason })}>批准草稿</button><button disabled={busy} className="review-outline" onClick={() => void command(`/api/v1/admin/policy-drafts/${draft.id}/review`, { decision: "rejected", reason })}>拒绝草稿</button></>}{isReviewer && draft.status === "approved" && <button disabled={busy} onClick={() => void command(`/api/v1/admin/policy-drafts/${draft.id}/publish`)}>发布政策并写入 Outbox</button>}</div></article>)}</div>}
  </section>;
}

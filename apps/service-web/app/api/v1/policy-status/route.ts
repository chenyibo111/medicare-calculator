export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return Response.json({
    mode: "demo",
    policySource: "本地已发布示例政策",
    cache: "服务端 TTL 缓存",
  });
}

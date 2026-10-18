// Armature MCP analytics: every tool call on this server becomes a scored session in Armature
// (use cases, issues, replays), so we can see whether agents get what they came for. One
// mcp-use middleware on tools/call records name, arguments, result, duration and session.
// Off unless ANALYTICS_INGEST_API_KEY is set, so local runs never phone home.
import { createAnalyticsRecorder, type AnalyticsRecorder } from "@armature-tech/mcp-analytics";
import type { MCPServer } from "mcp-use";

const textOf = (result: any) => (result?.content || []).filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n").slice(0, 500);

export function withArmature(server: MCPServer): AnalyticsRecorder | null {
  if (!process.env.ANALYTICS_INGEST_API_KEY) {
    console.log("[armature] ANALYTICS_INGEST_API_KEY not set; analytics off");
    return null;
  }
  const recorder = createAnalyticsRecorder({
    armature: {
      delivery: "background",
      onError: (error) => console.warn("[armature] delivery failed:", (error as Error)?.message || error),
    },
  });

  server.use("mcp:tools/call", async (ctx, next) => {
    const startedAt = Date.now();
    const { name, arguments: args } = ctx.params as { name: string; arguments?: unknown };
    const headers = ctx.request ? Object.fromEntries(ctx.request.raw.headers.entries()) : undefined;
    const sessionId = ctx.session?.sessionId ?? ctx.request?.header("mcp-session-id") ?? undefined;
    const record = (event: Record<string, unknown>) =>
      recorder.recordToolCall({ name, args, startedAt, durationMs: Date.now() - startedAt, sessionId, headers, ...event } as any).catch(() => {});
    try {
      const result = await next();
      const isError = Boolean((result as any)?.isError);
      void record({ status: isError ? "error" : "ok", result, ...(isError ? { error: textOf(result) } : {}) });
      return result;
    } catch (error) {
      void record({ status: "error", error });
      throw error;
    }
  });
  console.log("[armature] analytics on");
  return recorder;
}

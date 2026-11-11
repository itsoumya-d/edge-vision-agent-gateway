import { randomUUID } from "node:crypto";

export interface McpToolDef {
  name: string;
  description: string;
  requiredArgs: string[];
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export interface SseFrame {
  id: string;
  event: string;
  data: Record<string, unknown>;
}

export function formatSseFrame(frame: SseFrame): string {
  return `id: ${frame.id}\nevent: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`;
}

export class McpGatewayServer {
  private readonly tools = new Map<string, McpToolDef>();

  registerTool(def: McpToolDef): void {
    this.tools.set(def.name, def);
  }

  listTools(): Array<{ name: string; description: string; requiredArgs: string[] }> {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      requiredArgs: t.requiredArgs,
    }));
  }

  async invokeStream(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ ok: boolean; status: number; frames: string[]; result?: Record<string, unknown>; error?: string }> {
    const tool = this.tools.get(name);
    if (!tool) {
      const errFrame = formatSseFrame({
        id: randomUUID(),
        event: "error",
        data: { code: "TOOL_NOT_FOUND", name },
      });
      return { ok: false, status: 404, frames: [errFrame], error: `Unknown tool: ${name}` };
    }

    const missing = tool.requiredArgs.filter((k) => args[k] === undefined || args[k] === null || args[k] === "");
    if (missing.length > 0) {
      const errFrame = formatSseFrame({
        id: randomUUID(),
        event: "error",
        data: { code: "INVALID_ARGS", missing },
      });
      return { ok: false, status: 400, frames: [errFrame], error: `Missing args: ${missing.join(", ")}` };
    }

    const startedAt = Date.now();
    const startFrame = formatSseFrame({
      id: randomUUID(),
      event: "tool_start",
      data: { name, startedAt },
    });

    const result = await tool.handler(args);
    const doneFrame = formatSseFrame({
      id: randomUUID(),
      event: "tool_result",
      data: { name, elapsedMs: Date.now() - startedAt, result },
    });

    return { ok: true, status: 200, frames: [startFrame, doneFrame], result };
  }
}

import { spawn } from "node:child_process";
import { z } from "zod";

import {
  createPolicyAwareHarnessTool,
  type HarnessToolBinding,
} from "@town/harness";

const codeArguments = z
  .object({
    code: z.string().trim().min(1).max(20_000),
    timeoutMs: z.number().int().min(250).max(5_000).default(2_000),
    maxOutputChars: z.number().int().min(1_000).max(20_000).default(12_000),
  })
  .strict();

export interface CodeRunOptions {
  timeoutMs: number;
  maxOutputChars: number;
}

export interface CodeRunResult {
  output: string;
  truncated: boolean;
}

export async function runE2BCode(
  code: string,
  options: CodeRunOptions,
  apiKey: string,
): Promise<CodeRunResult> {
  const { Sandbox } = await import("@e2b/code-interpreter");
  const sandbox = await Sandbox.create({ apiKey });
  try {
    const execution = await sandbox.runCode(code, {
      language: "javascript",
      timeoutMs: options.timeoutMs,
    });
    const logs = execution.logs;
    let output = "";
    if (logs.stdout.length > 0) output += logs.stdout.join("\n");
    if (logs.stderr.length > 0)
      output += `${output.length > 0 ? "\n" : ""}${logs.stderr.join("\n")}`;
    const text = execution.text;
    if (text !== undefined) {
      output += `${output.length > 0 ? "\n" : ""}${text}`;
    }
    let truncated = false;
    if (output.length > options.maxOutputChars) {
      truncated = true;
      output = output.slice(0, options.maxOutputChars);
    }
    if (execution.error !== undefined) {
      throw new Error(`CODE_RUN_FAILED: ${execution.error.value}`);
    }
    return { output, truncated };
  } finally {
    await sandbox.kill();
  }
}

/**
 * Runs a small JavaScript expression in a separate Node process with the
 * permission model enabled. This is an execution boundary, not a claim of
 * E2B-equivalent isolation; callers must still require approval.
 */
export function runNodeCode(
  code: string,
  options: CodeRunOptions,
): Promise<CodeRunResult> {
  const script = [
    "const chunks = [];",
    "const write = (value) => chunks.push(String(value));",
    "console.log = write; console.info = write; console.error = write;",
    "Promise.resolve().then(async () => {",
    code,
    "}).then((value) => { if (value !== undefined) write(value); }, (error) => { write(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => { process.stdout.write(chunks.join('\\n')); });",
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--permission", "--disable-proto=throw", "--eval", script],
      {
        env: { PATH: process.env["PATH"] ?? "" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    let errorOutput = "";
    let truncated = false;
    let settled = false;
    const append = (chunk: Buffer, target: "output" | "error") => {
      if (target === "error") {
        errorOutput = `${errorOutput}${chunk.toString("utf8")}`.slice(-4_000);
        return;
      }
      const next = `${output}${chunk.toString("utf8")}`;
      if (next.length > options.maxOutputChars) truncated = true;
      output = next.slice(0, options.maxOutputChars);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("CODE_RUN_TIMEOUT"));
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => append(chunk, "output"));
    child.stderr.on("data", (chunk: Buffer) => append(chunk, "error"));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `CODE_RUN_FAILED${errorOutput.length > 0 ? `: ${errorOutput.trim()}` : ""}`,
          ),
        );
        return;
      }
      resolve({ output, truncated });
    });
  });
}

export function createTownCodeRunHarnessBinding(
  run: (
    code: string,
    options: CodeRunOptions,
  ) => Promise<CodeRunResult> = runNodeCode,
  e2bApiKey?: string,
): HarnessToolBinding {
  const definition = {
    name: "town_code_run",
    description:
      "Run bounded JavaScript in a separate permission-restricted Node process; code output is untrusted and execution always requires approval.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", minLength: 1, maxLength: 20_000 },
        timeoutMs: { type: "integer", minimum: 250, maximum: 5_000 },
        maxOutputChars: { type: "integer", minimum: 1_000, maximum: 20_000 },
      },
      required: ["code"],
      additionalProperties: false,
    },
  } as const;
  return createPolicyAwareHarnessTool({
    definition,
    decide: (arguments_) =>
      codeArguments.safeParse(arguments_).success
        ? "approval_required"
        : "deny",
    async execute(arguments_, context) {
      const value = codeArguments.parse(arguments_);
      if (!context?.approvalGranted)
        throw new Error("HARNESS_TOOL_APPROVAL_REQUIRED");
      const runner =
        e2bApiKey !== undefined
          ? (code: string, opts: CodeRunOptions) =>
              runE2BCode(code, opts, e2bApiKey)
          : run;
      const result = await runner(value.code, {
        timeoutMs: value.timeoutMs,
        maxOutputChars: value.maxOutputChars,
      });
      return {
        kind: "result",
        output: JSON.stringify(result),
      };
    },
  });
}

import { z } from "zod";

/**
 * Public, provider-independent descriptions for the built-in routines shown
 * in Town's product documentation. These are catalog entries only: they do
 * not claim to reproduce Town's private prompts, models, or tool graph.
 */
export const routineTemplateIdSchema = z.enum([
  "morning-briefing",
  "auto-inbox",
  "meeting-briefing",
  "daily-work-summary",
]);

export type RoutineTemplateId = z.infer<typeof routineTemplateIdSchema>;

export interface RoutineTemplate {
  id: RoutineTemplateId;
  name: string;
  summary: string;
  setupPrompt: string;
  defaultApprovalMode:
    "respect_tool_setting" | "require_approval" | "autonomous";
}

const templates: readonly RoutineTemplate[] = [
  {
    id: "morning-briefing",
    name: "Morning Briefing",
    summary: "Prepare a concise briefing from the day's connected context.",
    setupPrompt:
      "Every morning, prepare a concise briefing of my day and the things I need to stay on top of.",
    defaultApprovalMode: "require_approval",
  },
  {
    id: "auto-inbox",
    name: "Auto-inbox",
    summary: "Triage incoming email while keeping changes approval-gated.",
    setupPrompt:
      "When new email arrives, help triage it and suggest the next action without sending or changing anything without approval.",
    defaultApprovalMode: "require_approval",
  },
  {
    id: "meeting-briefing",
    name: "Meeting Briefing",
    summary: "Prepare context before an upcoming meeting.",
    setupPrompt:
      "Before each meeting, prepare a short briefing about the people, history, and topics that matter.",
    defaultApprovalMode: "require_approval",
  },
  {
    id: "daily-work-summary",
    name: "Daily Work Summary",
    summary: "Summarize the work and follow-ups that changed during the day.",
    setupPrompt:
      "At the end of each workday, summarize what changed and which follow-ups need my attention.",
    defaultApprovalMode: "require_approval",
  },
];

export function listRoutineTemplates(): RoutineTemplate[] {
  return templates.map((template) => ({ ...template }));
}

export function getRoutineTemplate(id: string): RoutineTemplate | undefined {
  const parsed = routineTemplateIdSchema.safeParse(id);
  if (!parsed.success) return undefined;
  return templates.find((template) => template.id === parsed.data);
}

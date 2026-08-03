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
  "newsletter-digest",
  "schedule-optimizer",
  "deal-spotter",
  "competitive-intel-briefing",
  "contact-research-dossier",
  "github-reports",
  "invoice-expense-logger",
  "travel-booking-organizer",
  "relationship-reconnect",
  "content-organizer",
  "new-user-research",
  "decline-cold-outreach",
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
  {
    id: "newsletter-digest",
    name: "Newsletter Digest",
    summary: "Turn subscribed newsletters into a concise digest.",
    setupPrompt:
      "Collect the newsletters I choose and prepare a concise digest of the useful items.",
    defaultApprovalMode: "require_approval",
  },
  {
    id: "schedule-optimizer",
    name: "Schedule Optimizer",
    summary: "Surface scheduling conflicts and practical openings.",
    setupPrompt:
      "Review my calendars and surface conflicts or opportunities to make my schedule easier to manage.",
    defaultApprovalMode: "require_approval",
  },
  {
    id: "deal-spotter",
    name: "Deal Spotter",
    summary: "Highlight deal-related updates that need attention.",
    setupPrompt:
      "Watch the connected deal context and highlight changes that may need my attention.",
    defaultApprovalMode: "require_approval",
  },
  {
    id: "competitive-intel-briefing",
    name: "Competitive Intel Briefing",
    summary: "Prepare a recurring briefing from selected competitive signals.",
    setupPrompt:
      "Prepare a recurring briefing of the competitive updates I choose to follow.",
    defaultApprovalMode: "require_approval",
  },
  {
    id: "contact-research-dossier",
    name: "Contact Research Dossier",
    summary: "Gather useful context before an important conversation.",
    setupPrompt:
      "Before an important conversation, gather a concise dossier from the connected context I authorize.",
    defaultApprovalMode: "require_approval",
  },
  {
    id: "github-reports",
    name: "GitHub Reports",
    summary: "Summarize selected repository activity and follow-ups.",
    setupPrompt:
      "Prepare a regular report about the repository activity and follow-ups I select.",
    defaultApprovalMode: "require_approval",
  },
  {
    id: "invoice-expense-logger",
    name: "Invoice & Expense Logger",
    summary: "Organize selected invoices and expense updates for review.",
    setupPrompt:
      "Collect the invoices and expenses I authorize and organize them for review without making payments.",
    defaultApprovalMode: "require_approval",
  },
  {
    id: "travel-booking-organizer",
    name: "Travel & Booking Organizer",
    summary: "Keep selected travel and booking details organized.",
    setupPrompt:
      "Organize the travel and booking details I authorize and surface the next useful follow-up.",
    defaultApprovalMode: "require_approval",
  },
  {
    id: "relationship-reconnect",
    name: "Relationship Reconnect",
    summary: "Remind you when selected relationships may need a touchpoint.",
    setupPrompt:
      "Remind me when it may be time to reconnect with people I select, using only authorized context.",
    defaultApprovalMode: "require_approval",
  },
  {
    id: "content-organizer",
    name: "Content Organizer",
    summary: "Help organize selected documents and content for review.",
    setupPrompt:
      "Organize the content I select and suggest a clear structure without deleting anything.",
    defaultApprovalMode: "require_approval",
  },
  {
    id: "new-user-research",
    name: "New User Research",
    summary: "Collect and summarize selected new-user feedback signals.",
    setupPrompt:
      "Collect the new-user feedback sources I authorize and summarize recurring themes for review.",
    defaultApprovalMode: "require_approval",
  },
  {
    id: "decline-cold-outreach",
    name: "Decline Cold Outreach",
    summary: "Draft safe responses for selected unwanted outreach.",
    setupPrompt:
      "Draft polite decline responses for the outreach I select, and wait for approval before sending.",
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

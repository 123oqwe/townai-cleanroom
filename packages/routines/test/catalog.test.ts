import { describe, expect, it } from "vitest";

import {
  getRoutineTemplate,
  listRoutineTemplates,
  routineTemplateIdSchema,
} from "../src/catalog.js";

describe("routine catalog", () => {
  it("lists the documented stock routine identities without private execution details", () => {
    const templates = listRoutineTemplates();

    expect(templates.map((template) => template.id)).toEqual([
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
    expect(
      templates.every(
        (template) => template.defaultApprovalMode === "require_approval",
      ),
    ).toBe(true);
    expect(templates.every((template) => !("model" in template))).toBe(true);
  });

  it("returns defensive copies and rejects unknown template ids", () => {
    const first = listRoutineTemplates();
    const firstTemplate = first[0];
    expect(firstTemplate).toBeDefined();
    if (firstTemplate !== undefined) firstTemplate.name = "changed locally";

    expect(getRoutineTemplate("morning-briefing")?.name).toBe(
      "Morning Briefing",
    );
    expect(getRoutineTemplate("unknown")).toBeUndefined();
    expect(routineTemplateIdSchema.safeParse("unknown").success).toBe(false);
  });
});

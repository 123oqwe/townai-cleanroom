import { z } from "zod";

import { type Id } from "@town/contracts";

export const suggestionKindSchema = z.enum(["assistant", "task", "routine"]);
export const suggestionStatusSchema = z.enum([
  "open",
  "dismissed",
  "converted",
]);
export type SuggestionKind = z.infer<typeof suggestionKindSchema>;
export type SuggestionStatus = z.infer<typeof suggestionStatusSchema>;

export interface Suggestion {
  id: Id<"suggestion">;
  ownerId: Id<"user">;
  kind: SuggestionKind;
  status: SuggestionStatus;
  title: string;
  body: string;
  sourceType: string;
  sourceRef: string;
  metadata: Record<string, unknown>;
  revision: number;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  convertedTaskId: Id<"task"> | null;
}
export interface SuggestionPage {
  items: Suggestion[];
  nextCursor: string | null;
}

export class SuggestionError extends Error {
  constructor(
    readonly code: "SUGGESTION_NOT_FOUND" | "SUGGESTION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "SuggestionError";
  }
}

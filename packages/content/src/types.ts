import { z } from "zod";

import { type Id } from "@town/contracts";

export const contentKindSchema = z.enum([
  "document",
  "email_draft",
  "spreadsheet",
  "deck",
  "file",
  "image",
  "video",
  "audio",
  "recording",
  "briefing",
  "link",
  "session",
]);
export const contentStatusSchema = z.enum(["active", "archived", "deleted"]);
export interface ContentItem {
  id: Id<"content">;
  ownerId: Id<"user">;
  kind: z.infer<typeof contentKindSchema>;
  title: string;
  mimeType: string | null;
  storageKey: string | null;
  body: string | null;
  metadata: Record<string, unknown>;
  sourceSessionId: Id<"runtime-session"> | null;
  status: z.infer<typeof contentStatusSchema>;
  currentRevision: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface ContentCollection {
  id: Id<"content-collection">;
  ownerId: Id<"user">;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface ContentShare {
  id: Id<"content-share">;
  contentId: Id<"content">;
  expiresAt: Date | null;
  createdAt: Date;
}
export interface ContentPage {
  items: ContentItem[];
  nextCursor: string | null;
}
export interface ContentRevision {
  id: Id<"content-revision">;
  contentId: Id<"content">;
  revision: number;
  title: string;
  mimeType: string | null;
  storageKey: string | null;
  body: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}
export interface PublicContent {
  id: Id<"content">;
  kind: ContentItem["kind"];
  title: string;
  mimeType: string | null;
  body: string | null;
}

export class ContentError extends Error {
  constructor(
    readonly code:
      | "CONTENT_NOT_FOUND"
      | "COLLECTION_NOT_FOUND"
      | "SHARE_NOT_FOUND"
      | "CONTENT_CONFLICT"
      | "CONTENT_ALREADY_EXISTS"
      | "COLLECTION_ALREADY_EXISTS",
    message: string,
  ) {
    super(message);
    this.name = "ContentError";
  }
}

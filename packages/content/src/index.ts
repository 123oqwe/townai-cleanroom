import { createHash, randomBytes } from "node:crypto";
import type { Sql } from "postgres";
import { z } from "zod";

import {
  asId,
  decodeCursor,
  encodeCursor,
  idSchema,
  newId,
  type Id,
} from "@town/contracts";

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
const metadataSchema = z.record(z.string(), z.json());
const payloadSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    mimeType: z.string().trim().min(1).max(255).nullable().optional(),
    storageKey: z.string().trim().min(1).max(2_000).nullable().optional(),
    body: z.string().nullable().optional(),
    metadata: metadataSchema.default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.storageKey == null && value.body == null)
      ctx.addIssue({
        code: "custom",
        message: "storageKey or body is required",
      });
  });
const updatePayloadSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    mimeType: z.string().trim().min(1).max(255).nullable().optional(),
    storageKey: z.string().trim().min(1).max(2_000).nullable().optional(),
    body: z.string().nullable().optional(),
    metadata: metadataSchema.default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.storageKey == null && value.body == null)
      ctx.addIssue({
        code: "custom",
        message: "storageKey or body is required",
      });
  });

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
type ContentRow = {
  id: string;
  owner_id: string;
  kind: ContentItem["kind"];
  title: string;
  mime_type: string | null;
  storage_key: string | null;
  body: string | null;
  metadata: Record<string, unknown>;
  source_session_id: string | null;
  status: ContentItem["status"];
  current_revision: number;
  created_at: Date;
  updated_at: Date;
};
type ShareRow = {
  id: string;
  content_id: string;
  expires_at: Date | null;
  created_at: Date;
};
function safe(row: ContentRow): ContentItem {
  return {
    id: asId("" + row.id),
    ownerId: asId(row.owner_id),
    kind: row.kind,
    title: row.title,
    mimeType: row.mime_type,
    storageKey: row.storage_key,
    body: row.body,
    metadata: row.metadata,
    sourceSessionId:
      row.source_session_id === null ? null : asId(row.source_session_id),
    status: row.status,
    currentRevision: row.current_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createContentRepository(sql: Sql) {
  async function get(
    ownerId: Id<"user">,
    contentId: Id<"content">,
  ): Promise<ContentItem> {
    const value = z
      .object({ ownerId: idSchema, contentId: idSchema })
      .parse({ ownerId, contentId });
    const [row] = await sql<
      ContentRow[]
    >`select * from content_items where owner_id=${value.ownerId} and id=${value.contentId}`;
    if (!row)
      throw new ContentError(
        "CONTENT_NOT_FOUND",
        "The content item was not found.",
      );
    return safe(row);
  }
  async function create(
    input: {
      ownerId: Id<"user">;
      kind: ContentItem["kind"];
      sourceSessionId?: Id<"runtime-session"> | null;
    } & z.input<typeof payloadSchema>,
  ): Promise<ContentItem> {
    const value = payloadSchema
      .extend({
        ownerId: idSchema,
        kind: contentKindSchema,
        sourceSessionId: idSchema.nullable().optional(),
      })
      .parse(input);
    const id = newId<"content">();
    try {
      await sql.begin(async (tx) => {
        await tx`insert into content_items (id,owner_id,kind,title,mime_type,storage_key,body,metadata,source_session_id) values (${id},${value.ownerId},${value.kind},${value.title},${value.mimeType ?? null},${value.storageKey ?? null},${value.body ?? null},${tx.json(value.metadata)},${value.sourceSessionId ?? null})`;
        await tx`insert into content_revisions (id,content_id,owner_id,revision,title,mime_type,storage_key,body,metadata) values (${newId<"content-revision">()},${id},${value.ownerId},1,${value.title},${value.mimeType ?? null},${value.storageKey ?? null},${value.body ?? null},${tx.json(value.metadata)})`;
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "constraint_name" in error &&
        error.constraint_name === "content_items_owner_storage_key_unique"
      )
        throw new ContentError(
          "CONTENT_ALREADY_EXISTS",
          "This storage object is already registered.",
        );
      throw error;
    }
    return get(asId<"user">(value.ownerId), id);
  }
  async function update(
    input: {
      ownerId: Id<"user">;
      contentId: Id<"content">;
      expectedRevision: number;
    } & Omit<z.input<typeof payloadSchema>, "kind">,
  ): Promise<ContentItem> {
    const value = updatePayloadSchema
      .extend({
        ownerId: idSchema,
        contentId: idSchema,
        expectedRevision: z.number().int().positive(),
      })
      .parse(input);
    const revisionId = newId<"content-revision">();
    let rows: ContentRow[];
    try {
      rows = await sql.begin(async (tx) => {
        const updated = await tx<
          ContentRow[]
        >`update content_items set title=${value.title},mime_type=${value.mimeType ?? null},storage_key=${value.storageKey ?? null},body=${value.body ?? null},metadata=${tx.json(value.metadata)},current_revision=current_revision+1,updated_at=now() where owner_id=${value.ownerId} and id=${value.contentId} and current_revision=${value.expectedRevision} and status <> 'deleted' returning *`;
        if (!updated[0]) return [] as ContentRow[];
        await tx`insert into content_revisions (id,content_id,owner_id,revision,title,mime_type,storage_key,body,metadata) values (${revisionId},${value.contentId},${value.ownerId},${value.expectedRevision + 1},${value.title},${value.mimeType ?? null},${value.storageKey ?? null},${value.body ?? null},${tx.json(value.metadata)})`;
        return updated;
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "constraint_name" in error &&
        error.constraint_name === "content_items_owner_storage_key_unique"
      )
        throw new ContentError(
          "CONTENT_ALREADY_EXISTS",
          "This storage object is already registered.",
        );
      throw error;
    }
    if (!rows[0]) {
      const current = await get(
        asId<"user">(value.ownerId),
        asId<"content">(value.contentId),
      ).catch(() => null);
      if (!current)
        throw new ContentError(
          "CONTENT_NOT_FOUND",
          "The content item was not found.",
        );
      throw new ContentError(
        "CONTENT_CONFLICT",
        "The content revision is stale.",
      );
    }
    return safe(rows[0] as ContentRow);
  }
  async function list(
    ownerId: Id<"user">,
    options?: { status?: ContentItem["status"]; limit?: number },
  ): Promise<ContentItem[]> {
    return (await listPage({ ownerId, ...options })).items;
  }
  async function listPage(input: {
    ownerId: Id<"user">;
    status?: ContentItem["status"];
    limit?: number;
    cursor?: string;
  }): Promise<ContentPage> {
    const value = z
      .object({
        ownerId: idSchema,
        status: contentStatusSchema.optional(),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().min(1).optional(),
      })
      .parse(input);
    const decoded =
      value.cursor === undefined ? null : decodeCursor(value.cursor);
    const cursorKey =
      decoded === null
        ? null
        : z
            .object({
              status: contentStatusSchema.optional(),
              updatedAt: z.iso.datetime(),
            })
            .strict()
            .parse(JSON.parse(decoded.key));
    if (cursorKey !== null && cursorKey.status !== value.status)
      throw new z.ZodError([
        {
          code: "custom",
          path: ["cursor"],
          message: "Cursor status does not match the requested status.",
        },
      ]);
    const before = cursorKey?.updatedAt ?? null;
    const beforeId = decoded?.id ?? "00000000-0000-7000-8000-000000000000";
    const rows =
      value.status === undefined
        ? await sql<
            ContentRow[]
          >`select * from content_items where owner_id=${value.ownerId} and (${cursorKey === null} or updated_at < ${before}::timestamptz or (updated_at = ${before}::timestamptz and id < ${beforeId}::uuid)) order by updated_at desc,id desc limit ${value.limit + 1}`
        : await sql<
            ContentRow[]
          >`select * from content_items where owner_id=${value.ownerId} and status=${value.status} and (${cursorKey === null} or updated_at < ${before}::timestamptz or (updated_at = ${before}::timestamptz and id < ${beforeId}::uuid)) order by updated_at desc,id desc limit ${value.limit + 1}`;
    const hasMore = rows.length > value.limit;
    const pageRows = hasMore ? rows.slice(0, value.limit) : rows;
    const last = hasMore ? pageRows.at(-1) : undefined;
    return {
      items: pageRows.map(safe),
      nextCursor:
        last === undefined
          ? null
          : encodeCursor({
              version: 1,
              key: JSON.stringify({
                status: value.status,
                updatedAt: last.updated_at.toISOString(),
              }),
              id: asId(last.id),
            }),
    };
  }
  async function archive(
    ownerId: Id<"user">,
    contentId: Id<"content">,
  ): Promise<ContentItem> {
    const value = z
      .object({ ownerId: idSchema, contentId: idSchema })
      .parse({ ownerId, contentId });
    const rows = await sql<
      ContentRow[]
    >`update content_items set status='archived',updated_at=now() where owner_id=${value.ownerId} and id=${value.contentId} and status='active' returning *`;
    if (!rows[0])
      throw new ContentError(
        "CONTENT_NOT_FOUND",
        "The content item was not found.",
      );
    return safe(rows[0]);
  }
  async function listRevisions(
    ownerId: Id<"user">,
    contentId: Id<"content">,
  ): Promise<ContentRevision[]> {
    const value = z
      .object({ ownerId: idSchema, contentId: idSchema })
      .parse({ ownerId, contentId });
    const rows = await sql<
      {
        id: string;
        content_id: string;
        revision: number;
        title: string;
        mime_type: string | null;
        storage_key: string | null;
        body: string | null;
        metadata: Record<string, unknown>;
        created_at: Date;
      }[]
    >`select r.* from content_revisions r where r.owner_id=${value.ownerId} and r.content_id=${value.contentId} order by r.revision desc`;
    if (rows.length === 0)
      await get(asId<"user">(value.ownerId), asId<"content">(value.contentId));
    return rows.map((row) => ({
      id: asId<"content-revision">(row.id),
      contentId: asId<"content">(row.content_id),
      revision: row.revision,
      title: row.title,
      mimeType: row.mime_type,
      storageKey: row.storage_key,
      body: row.body,
      metadata: row.metadata,
      createdAt: row.created_at,
    }));
  }
  async function createCollection(input: {
    ownerId: Id<"user">;
    name: string;
    description?: string;
  }): Promise<ContentCollection> {
    const value = z
      .object({
        ownerId: idSchema,
        name: z.string().trim().min(1).max(200),
        description: z.string().max(2_000).default(""),
      })
      .strict()
      .parse(input);
    const id = newId<"content-collection">();
    try {
      const [row] = await sql<
        {
          id: string;
          owner_id: string;
          name: string;
          description: string;
          created_at: Date;
          updated_at: Date;
        }[]
      >`insert into content_collections (id,owner_id,name,description) values (${id},${value.ownerId},${value.name},${value.description}) returning id,owner_id,name,description,created_at,updated_at`;
      if (!row) throw new Error("COLLECTION_CREATE_FAILED");
      return {
        id: asId<"content-collection">(row.id),
        ownerId: asId<"user">(row.owner_id),
        name: row.name,
        description: row.description,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "constraint_name" in error &&
        error.constraint_name === "content_collections_owner_id_name_key"
      )
        throw new ContentError(
          "COLLECTION_ALREADY_EXISTS",
          "A collection with this name already exists.",
        );
      throw error;
    }
  }
  async function listCollections(
    ownerId: Id<"user">,
  ): Promise<ContentCollection[]> {
    const value = idSchema.parse(ownerId);
    const rows = await sql<
      {
        id: string;
        owner_id: string;
        name: string;
        description: string;
        created_at: Date;
        updated_at: Date;
      }[]
    >`
      select id,owner_id,name,description,created_at,updated_at
      from content_collections where owner_id=${value}
      order by updated_at desc,id desc`;
    return rows.map((row) => ({
      id: asId<"content-collection">(row.id),
      ownerId: asId<"user">(row.owner_id),
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
  async function addToCollection(
    ownerId: Id<"user">,
    collectionId: Id<"content-collection">,
    contentId: Id<"content">,
    position = 0,
  ): Promise<void> {
    const value = z
      .object({
        ownerId: idSchema,
        collectionId: idSchema,
        contentId: idSchema,
        position: z.number().int().min(0).max(2_000_000_000),
      })
      .parse({ ownerId, collectionId, contentId, position });
    const rows =
      await sql`insert into content_collection_items (collection_id,content_id,owner_id,position) select c.id,i.id,${value.ownerId},${value.position} from content_collections c join content_items i on i.owner_id=c.owner_id and i.id=${value.contentId} where c.owner_id=${value.ownerId} and c.id=${value.collectionId} on conflict (collection_id,content_id) do update set position=excluded.position returning collection_id`;
    if (rows.length !== 1)
      throw new ContentError(
        "COLLECTION_NOT_FOUND",
        "The collection or content item was not found.",
      );
  }
  async function listCollection(
    ownerId: Id<"user">,
    collectionId: Id<"content-collection">,
  ): Promise<ContentItem[]> {
    const value = z
      .object({ ownerId: idSchema, collectionId: idSchema })
      .parse({ ownerId, collectionId });
    const [collection] =
      await sql`select id from content_collections where owner_id=${value.ownerId} and id=${value.collectionId}`;
    if (!collection)
      throw new ContentError(
        "COLLECTION_NOT_FOUND",
        "The collection was not found.",
      );
    const rows = await sql<
      ContentRow[]
    >`select i.* from content_collection_items ci join content_items i on i.id=ci.content_id and i.owner_id=ci.owner_id where ci.owner_id=${value.ownerId} and ci.collection_id=${value.collectionId} order by ci.position,ci.content_id`;
    return rows.map(safe);
  }
  async function createShare(
    ownerId: Id<"user">,
    contentId: Id<"content">,
    expiresAt?: Date | null,
  ): Promise<{ share: ContentShare; token: string }> {
    const content = await get(ownerId, contentId);
    if (content.status !== "active")
      throw new ContentError(
        "CONTENT_NOT_FOUND",
        "Only active content can be shared.",
      );
    if (
      expiresAt !== undefined &&
      expiresAt !== null &&
      expiresAt <= new Date()
    )
      throw new ContentError(
        "CONTENT_CONFLICT",
        "Share expiry must be in the future.",
      );
    const token = randomBytes(32).toString("base64url");
    const id = newId<"content-share">();
    const hash = createHash("sha256").update(token).digest();
    const [row] = await sql<
      ShareRow[]
    >`insert into content_share_tokens (id,content_id,owner_id,token_hash,expires_at) values (${id},${contentId},${ownerId},${hash},${expiresAt ?? null}) returning id,content_id,expires_at,created_at`;
    if (!row) throw new Error("CONTENT_SHARE_CREATE_FAILED");
    return {
      share: {
        id: asId<"content-share">(row.id),
        contentId: asId<"content">(row.content_id),
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      },
      token,
    };
  }
  async function resolveShare(token: string): Promise<ContentItem> {
    const parsed = z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .safeParse(token);
    if (!parsed.success)
      throw new ContentError(
        "SHARE_NOT_FOUND",
        "The share token is invalid or expired.",
      );
    const hash = createHash("sha256").update(parsed.data).digest();
    const [row] = await sql<
      ContentRow[]
    >`select content_items.* from content_share_tokens join content_items on content_items.id=content_share_tokens.content_id where content_share_tokens.token_hash=${hash} and content_share_tokens.revoked_at is null and (content_share_tokens.expires_at is null or content_share_tokens.expires_at > now()) and content_items.status='active'`;
    if (!row)
      throw new ContentError(
        "SHARE_NOT_FOUND",
        "The share token is invalid or expired.",
      );
    return safe(row);
  }
  function toPublic(item: ContentItem): PublicContent {
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      mimeType: item.mimeType,
      body: item.body,
    };
  }
  async function revokeShare(
    ownerId: Id<"user">,
    shareId: Id<"content-share">,
  ): Promise<void> {
    const rows =
      await sql`update content_share_tokens set revoked_at=now() where id=${shareId} and owner_id=${ownerId} and revoked_at is null returning id`;
    if (rows.length !== 1)
      throw new ContentError(
        "SHARE_NOT_FOUND",
        "The share token was not found.",
      );
  }
  return {
    get,
    create,
    update,
    list,
    listPage,
    listRevisions,
    archive,
    createCollection,
    listCollections,
    addToCollection,
    listCollection,
    createShare,
    resolveShare,
    toPublic,
    revokeShare,
  };
}
export type ContentRepository = ReturnType<typeof createContentRepository>;

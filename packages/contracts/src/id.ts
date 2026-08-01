import { v7 as uuidv7 } from "uuid";
import { z } from "zod";

export type Id<Kind extends string> = string & { readonly __kind: Kind };

export const idSchema = z.uuidv7();

export function newId<Kind extends string>(): Id<Kind> {
  return uuidv7() as Id<Kind>;
}

export function asId<Kind extends string>(value: unknown): Id<Kind> {
  return idSchema.parse(value) as Id<Kind>;
}

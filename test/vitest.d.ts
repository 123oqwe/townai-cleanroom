declare module "vitest" {
  export interface ProvidedContext {
    postgresUrl: string;
  }
}

export {};

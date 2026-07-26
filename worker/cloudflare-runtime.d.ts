interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta: unknown;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface Fetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

type ExportedHandler<Env = unknown> = {
  fetch?: (request: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response>;
  scheduled?: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => void | Promise<void>;
};

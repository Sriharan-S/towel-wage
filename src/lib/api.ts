import type {
  Advance,
  AdvanceKind,
  Bootstrap,
  Entry,
  Settings,
  WeekResult,
  WorkType,
  Worker,
  WorkerRate,
} from "@shared/types";
import type { ISODate } from "@shared/dates";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    // The API always returns { error } on failure; fall back if it didn't.
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep the generic message */
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// --- shapes returned by the aggregate endpoints -----------------------------

export interface WeekSummary {
  weekStart: ISODate;
  weekEnd: ISODate;
  status: "open" | "finalized";
  finalizedAt: string | null;
  totals: WeekResult["totals"];
  workerCount: number;
  paidCount: number;
  workers: Array<{
    workerId: number;
    workerName: string;
    wage: number;
    netPayable: number;
    paidAt: string | null;
  }>;
}

export interface DashboardStats {
  today: ISODate;
  currentWeek: ISODate;
  weeks: Array<{
    weekStart: ISODate;
    weekEnd: ISODate;
    wage: number;
    quantity: number;
    byWorker: Record<number, number>;
    byWorkType: Record<number, { wage: number; quantity: number }>;
  }>;
  daily: Array<{ date: ISODate; wage: number; quantity: number; entryCount: number }>;
  dayOfWeek: Array<{
    dayOfWeek: number;
    avgQuantity: number;
    avgWage: number;
    daysRecorded: number;
  }>;
  balances: Array<{
    workerId: number;
    workerName: string;
    creditOutstanding: number;
    debitOutstanding: number;
    net: number;
  }>;
  workers: Array<{ id: number; name: string; isActive: boolean }>;
  workTypes: Array<{
    id: number;
    name: string;
    color: string;
    kind: string;
    unitLabel: string;
  }>;
  kpis: {
    thisWeekWage: number;
    lastWeekWage: number;
    thisWeekQuantity: number;
    lastWeekQuantity: number;
    activeWorkers: number;
    totalCreditOutstanding: number;
    totalDebitOutstanding: number;
    missingDays: ISODate[];
  };
}

export interface WorkerStats {
  workerId: number;
  weeks: Array<{
    weekStart: ISODate;
    wage: number;
    quantity: number;
    effectiveRate: number;
    byWorkType: Array<{
      workTypeId: number;
      name: string;
      color: string;
      wage: number;
      quantity: number;
    }>;
  }>;
}

export interface DayEntryInput {
  workerId: number;
  workTypeId: number;
  /** 1-based loom number */
  loom: number;
  quantity?: number;
  amount?: number;
  note?: string | null;
}

export interface RateInput {
  workTypeId: number;
  unitPrice: number;
  divisor: number;
  multiplier: number;
  looms: number;
  isActive?: boolean;
}

export interface AdjustmentInput {
  credit?: number;
  deduct?: number;
  debit?: number;
  addback?: number;
  advanceRecovered?: number;
  note?: string | null;
  paid?: boolean;
}

export interface AdvanceInput {
  workerId: number;
  entryDate: ISODate;
  kind: AdvanceKind;
  amount: number;
  note?: string | null;
}

export interface AdvanceLedgerRow {
  date: ISODate;
  kind: "advance" | "repayment" | "recovered";
  amount: number;
  note: string | null;
  running: number;
}

/** Soft-delete responses tell the caller the row was kept for history. */
export type DeleteResult =
  | { deleted: true }
  | { deactivated: true; entryCount: number; message: string };

export const api = {
  bootstrap: () => request<Bootstrap>("/bootstrap"),

  workers: {
    list: () => request<Worker[]>("/workers"),
    create: (body: { name: string; phone?: string | null; notes?: string | null }) =>
      send<Worker>("POST", "/workers", body),
    update: (id: number, body: Partial<Worker>) =>
      send<Worker>("PATCH", `/workers/${id}`, body),
    remove: (id: number) => send<DeleteResult>("DELETE", `/workers/${id}`),
    reorder: (ids: number[]) => send<{ ok: true }>("PUT", "/workers/reorder", { ids }),
    rates: (id: number) => request<WorkerRate[]>(`/workers/${id}/rates`),
    setRates: (id: number, rates: RateInput[]) =>
      send<WorkerRate[]>("PUT", `/workers/${id}/rates`, { rates }),
  },

  workTypes: {
    list: () => request<WorkType[]>("/work-types"),
    create: (body: Record<string, unknown>) => send<WorkType>("POST", "/work-types", body),
    update: (id: number, body: Partial<WorkType>) =>
      send<WorkType>("PATCH", `/work-types/${id}`, body),
    remove: (id: number) => send<DeleteResult>("DELETE", `/work-types/${id}`),
    reorder: (ids: number[]) => send<{ ok: true }>("PUT", "/work-types/reorder", { ids }),
  },

  entries: {
    forDate: (date: ISODate) => request<Entry[]>(`/entries?date=${date}`),
    forRange: (from: ISODate, to: ISODate) =>
      request<Entry[]>(`/entries?from=${from}&to=${to}`),
    saveDay: (date: ISODate, entries: DayEntryInput[]) =>
      send<{ date: ISODate; weekStart: ISODate; entries: Entry[] }>(
        "PUT",
        `/entries/${date}`,
        { entries },
      ),
    copy: (from: ISODate, to: ISODate, workerId?: number) =>
      send<{ copied: number; message?: string }>("POST", "/entries/copy", {
        from,
        to,
        workerId,
      }),
  },

  weeks: {
    list: (params: { from?: ISODate; to?: ISODate; limit?: number } = {}) => {
      const search = new URLSearchParams();
      if (params.from) search.set("from", params.from);
      if (params.to) search.set("to", params.to);
      if (params.limit) search.set("limit", String(params.limit));
      const qs = search.toString();
      return request<WeekSummary[]>(`/weeks${qs ? `?${qs}` : ""}`);
    },
    get: (weekStart: ISODate) => request<WeekResult>(`/weeks/${weekStart}`),
    setAdjustments: (weekStart: ISODate, workerId: number, body: AdjustmentInput) =>
      send<WeekResult>("PUT", `/weeks/${weekStart}/adjustments/${workerId}`, body),
    /** Apply the settlement proposal — one worker, or everyone when omitted. */
    settle: (weekStart: ISODate, workerId?: number) =>
      send<WeekResult>(
        "POST",
        `/weeks/${weekStart}/settle${workerId ? `/${workerId}` : ""}`,
      ),
    finalize: (weekStart: ISODate) =>
      send<WeekResult>("POST", `/weeks/${weekStart}/finalize`),
    reopen: (weekStart: ISODate) => send<WeekResult>("POST", `/weeks/${weekStart}/reopen`),
  },

  stats: {
    summary: (weeks = 12) => request<DashboardStats>(`/stats/summary?weeks=${weeks}`),
    worker: (workerId: number, weeks = 12) =>
      request<WorkerStats>(`/stats/worker/${workerId}?weeks=${weeks}`),
  },

  advances: {
    list: (params: { workerId?: number; week?: ISODate } = {}) => {
      const search = new URLSearchParams();
      if (params.workerId) search.set("workerId", String(params.workerId));
      if (params.week) search.set("week", params.week);
      const qs = search.toString();
      return request<Advance[]>(`/advances${qs ? `?${qs}` : ""}`);
    },
    outstanding: () =>
      request<Array<{ workerId: number; outstanding: number }>>("/advances/outstanding"),
    create: (body: AdvanceInput) => send<Advance>("POST", "/advances", body),
    update: (id: number, body: Partial<AdvanceInput>) =>
      send<Advance>("PATCH", `/advances/${id}`, body),
    remove: (id: number) => send<{ deleted: true }>("DELETE", `/advances/${id}`),
    ledger: (workerId: number) =>
      request<{ workerId: number; outstanding: number; ledger: AdvanceLedgerRow[] }>(
        `/advances/worker/${workerId}/ledger`,
      ),
  },

  settings: {
    get: () => request<Settings>("/settings"),
    update: (body: Partial<Settings>) => send<Settings>("PATCH", "/settings", body),
  },

  backup: {
    exportUrl: (format: "json" | "csv") => `/api/backup/export?format=${format}`,
    restore: (data: unknown) =>
      send<{ restored: true }>("POST", "/backup/import", {
        confirm: "replace-all",
        ...(data as object),
      }),
  },
};

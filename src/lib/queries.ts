import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ISODate } from "@shared/dates";
import { todayISO } from "@shared/dates";
import {
  api,
  type AdjustmentInput,
  type BonusInput,
  type DayEntryInput,
  type RateInput,
} from "./api";

export const keys = {
  bootstrap: ["bootstrap"] as const,
  workers: ["workers"] as const,
  workTypes: ["work-types"] as const,
  rates: (workerId: number) => ["rates", workerId] as const,
  entries: (date: ISODate) => ["entries", date] as const,
  week: (weekStart: ISODate) => ["week", weekStart] as const,
  weeks: (params: object) => ["weeks", params] as const,
  stats: (weeks: number) => ["stats", weeks] as const,
  workerStats: (workerId: number, weeks: number) =>
    ["stats", "worker", workerId, weeks] as const,
  settings: ["settings"] as const,
};

/**
 * Bootstrap is the app's backbone — workers, towel types, rate assignments and
 * settings. Kept fresh for a minute since it changes only when the user edits
 * configuration, which invalidates it explicitly anyway.
 */
export function useBootstrap() {
  return useQuery({
    queryKey: keys.bootstrap,
    queryFn: api.bootstrap,
    staleTime: 60_000,
  });
}

/** Today's date in the business timezone, falling back to the browser's. */
export function useToday(): ISODate {
  const { data } = useBootstrap();
  return data?.today ?? todayISO(data?.settings.timezone);
}

export function useEntriesForDate(date: ISODate) {
  return useQuery({
    queryKey: keys.entries(date),
    queryFn: () => api.entries.forDate(date),
  });
}

export function useWeek(weekStart: ISODate) {
  return useQuery({
    queryKey: keys.week(weekStart),
    queryFn: () => api.weeks.get(weekStart),
  });
}

export function useWeekList(params: { from?: ISODate; to?: ISODate; limit?: number } = {}) {
  return useQuery({
    queryKey: keys.weeks(params),
    queryFn: () => api.weeks.list(params),
  });
}

export function useStats(weeks = 12) {
  return useQuery({
    queryKey: keys.stats(weeks),
    queryFn: () => api.stats.summary(weeks),
  });
}

export function useWorkerStats(workerId: number, weeks = 12) {
  return useQuery({
    queryKey: keys.workerStats(workerId, weeks),
    queryFn: () => api.stats.worker(workerId, weeks),
    enabled: workerId > 0,
  });
}

export function useWeekCalendar(year: number) {
  return useQuery({
    queryKey: ["calendar", year],
    queryFn: () => api.weeks.calendar(year),
    staleTime: 0,
  });
}

/**
 * Finalize or reset several weeks, one request each, so a failure part-way says
 * exactly which weeks were done. Stops nothing early: every week gets its turn.
 */
export function useBulkWeekAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, weeks }: { action: "finalize" | "reset"; weeks: ISODate[] }) => {
      const failed: ISODate[] = [];
      for (const weekStart of weeks) {
        try {
          if (action === "finalize") await api.weeks.finalize(weekStart);
          else await api.weeks.reset(weekStart);
        } catch {
          failed.push(weekStart);
        }
      }
      return { done: weeks.length - failed.length, failed };
    },
    onSuccess: () => {
      for (const queryKey of [["calendar"], ["week"], ["weeks"], ["stats"], ["entries"], ["bonus"]]) {
        client.invalidateQueries({ queryKey });
      }
    },
  });
}

export function useWorkerEarnings(workerId: number, from: ISODate, to: ISODate) {
  return useQuery({
    queryKey: ["stats", "earnings", workerId, from, to],
    queryFn: () => api.stats.earnings(workerId, from, to),
    enabled: Boolean(from && to && from <= to),
  });
}

/**
 * Saving a day also changes that day's week total and the dashboard, so both
 * are invalidated alongside the day itself.
 */
export function useSaveDay(date: ISODate) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (entries: DayEntryInput[]) => api.entries.saveDay(date, entries),
    onSuccess: (result) => {
      client.setQueryData(keys.entries(date), result.entries);
      client.invalidateQueries({ queryKey: keys.week(result.weekStart) });
      client.invalidateQueries({ queryKey: ["stats"] });
      client.invalidateQueries({ queryKey: ["weeks"] });
    },
  });
}

export function useCopyDay() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to, workerId }: { from: ISODate; to: ISODate; workerId?: number }) =>
      api.entries.copy(from, to, workerId),
    onSuccess: (_result, variables) => {
      client.invalidateQueries({ queryKey: keys.entries(variables.to) });
      client.invalidateQueries({ queryKey: ["week"] });
      client.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useSetAdjustments(weekStart: ISODate) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ workerId, ...body }: AdjustmentInput & { workerId: number }) =>
      api.weeks.setAdjustments(weekStart, workerId, body),
    onSuccess: (week) => {
      client.setQueryData(keys.week(weekStart), week);
      // Later weeks' suggested carry-forward depends on this week's numbers.
      client.invalidateQueries({ queryKey: ["week"] });
      client.invalidateQueries({ queryKey: ["weeks"] });
      client.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useSetOldRecord(weekStart: ISODate) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ workerId, amount }: { workerId: number; amount: number | null }) =>
      api.weeks.setOldRecord(weekStart, workerId, amount),
    onSuccess: (week) => {
      client.setQueryData(keys.week(weekStart), week);
      client.invalidateQueries({ queryKey: ["week"] });
      client.invalidateQueries({ queryKey: ["weeks"] });
      client.invalidateQueries({ queryKey: ["stats"] });
      client.invalidateQueries({ queryKey: ["bonus"] });
    },
  });
}

/** Always re-read: a draft moves whenever any wage in its range does. */
export function useBonus(year: number) {
  return useQuery({
    queryKey: ["bonus", year],
    queryFn: () => api.bonus.get(year),
    staleTime: 0,
  });
}

/** The bonus ending on this week. Managers cannot read it, so they never ask. */
export function useBonusForWeek(weekStart: ISODate, enabled: boolean) {
  return useQuery({
    queryKey: ["bonus", "week", weekStart],
    queryFn: () => api.bonus.forWeek(weekStart),
    enabled,
    staleTime: 0,
  });
}

export function useBonusAction(year: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: BonusInput | "finalize" | "reopen") =>
      action === "finalize"
        ? api.bonus.finalize(year)
        : action === "reopen"
          ? api.bonus.reopen(year)
          : api.bonus.save(year, action),
    onSuccess: (run) => {
      client.setQueryData(["bonus", year], run);
      client.invalidateQueries({ queryKey: ["bonus", "week"] });
    },
  });
}

/**
 * Sign out.
 *
 * Clears the whole cache as well as the cookie — otherwise the next person to
 * open the app would see the previous session's data flash up before the gate
 * appeared.
 */
export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.auth.logout,
    onSuccess: () => {
      client.clear();
      client.invalidateQueries({ queryKey: ["auth", "session"] });
    },
  });
}

export function useAdvances(params: { workerId?: number; week?: ISODate } = {}) {
  return useQuery({
    queryKey: ["advances", params],
    queryFn: () => api.advances.list(params),
  });
}

export function useAdvanceLedger(workerId: number) {
  return useQuery({
    queryKey: ["advances", "ledger", workerId],
    queryFn: () => api.advances.ledger(workerId),
    enabled: workerId > 0,
  });
}

/** An advance changes the week's payout picture, so refresh the week too. */
function useAdvanceMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["advances"] });
      client.invalidateQueries({ queryKey: ["week"] });
      client.invalidateQueries({ queryKey: ["weeks"] });
      client.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export const useCreateAdvance = () => useAdvanceMutation(api.advances.create);
export const useDeleteAdvance = () => useAdvanceMutation(api.advances.remove);

export function useSettleWeek(weekStart: ISODate) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (workerId?: number) => api.weeks.settle(weekStart, workerId),
    onSuccess: (week) => {
      client.setQueryData(keys.week(weekStart), week);
      client.invalidateQueries({ queryKey: ["week"] });
      client.invalidateQueries({ queryKey: ["weeks"] });
      client.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useFinalizeWeek(weekStart: ISODate) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: "finalize" | "reopen") =>
      action === "finalize" ? api.weeks.finalize(weekStart) : api.weeks.reopen(weekStart),
    onSuccess: (week) => {
      client.setQueryData(keys.week(weekStart), week);
      client.invalidateQueries({ queryKey: ["weeks"] });
      client.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

/** Any change to workers, towel types or rates reshapes the whole app. */
function useConfigMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.bootstrap });
      client.invalidateQueries({ queryKey: ["entries"] });
      client.invalidateQueries({ queryKey: ["week"] });
      client.invalidateQueries({ queryKey: ["weeks"] });
      client.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export const useCreateWorker = () =>
  useConfigMutation(api.workers.create);

export const useUpdateWorker = () =>
  useConfigMutation(({ id, ...body }: { id: number } & Record<string, unknown>) =>
    api.workers.update(id, body),
  );

export const useDeleteWorker = () => useConfigMutation(api.workers.remove);

export const useReorderWorkers = () => useConfigMutation(api.workers.reorder);

export const useReorderRates = () =>
  useConfigMutation(({ workerId, workTypeIds }: { workerId: number; workTypeIds: number[] }) =>
    api.workers.reorderRates(workerId, workTypeIds),
  );

export const useSetRates = () =>
  useConfigMutation(({ workerId, rates }: { workerId: number; rates: RateInput[] }) =>
    api.workers.setRates(workerId, rates),
  );

export const useCreateWorkType = () => useConfigMutation(api.workTypes.create);

export const useUpdateWorkType = () =>
  useConfigMutation(({ id, ...body }: { id: number } & Record<string, unknown>) =>
    api.workTypes.update(id, body),
  );

export const useDeleteWorkType = () => useConfigMutation(api.workTypes.remove);

export const useReorderWorkTypes = () => useConfigMutation(api.workTypes.reorder);

export const useUpdateSettings = () => useConfigMutation(api.settings.update);

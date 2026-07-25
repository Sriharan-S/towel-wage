import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ISODate } from "@shared/dates";
import { todayISO } from "@shared/dates";
import { api, type AdjustmentInput, type DayEntryInput, type RateInput } from "./api";

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

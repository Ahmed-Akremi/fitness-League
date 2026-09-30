import { useQuery } from '@tanstack/react-query';

import { useServices } from '../../core/services';

export interface Page<T> {
  data: T[];
  page: { nextCursor: string | null; hasMore: boolean };
}

export interface WorkoutSet {
  reps?: number | null;
  weightKg?: number | null;
  distanceM?: number | null;
  durationS?: number | null;
  isWarmup?: boolean;
}

export interface Workout {
  id: string;
  status: 'ACCEPTED' | 'HELD_FOR_REVIEW' | 'REJECTED' | string;
  performedAt: string;
  durationS: number;
  totalVolumeKg?: number | null;
  totalDistanceM?: number | null;
  exercises?: { exerciseId: string; exercise?: { name?: unknown }; sets: WorkoutSet[] }[];
  [k: string]: unknown;
}

export interface PointsEntry {
  reason: string;
  amount: number;
  explanation?: { steps?: { label: string; value: unknown }[]; caps?: { label: string; value: unknown; applied?: boolean }[]; formula?: string } | null;
}

export interface WorkoutPoints {
  totalXp: number;
  entries: PointsEntry[];
}

export const workoutKeys = {
  list: ['workouts'] as const,
  detail: (id: string) => ['workouts', id] as const,
  outbox: ['outbox'] as const,
};

export function useWorkouts() {
  const { api } = useServices();
  return useQuery({ queryKey: workoutKeys.list, queryFn: () => api.get<Page<Workout>>('/workouts', { limit: 20 }) });
}

export function useWorkoutDetail(id: string) {
  const { api } = useServices();
  return useQuery({
    queryKey: workoutKeys.detail(id),
    queryFn: () => Promise.all([api.get<Workout>(`/workouts/${id}`), api.get<WorkoutPoints>(`/workouts/${id}/points`)]),
  });
}

/** Workouts waiting in the offline outbox (pending, conflict or rejected). */
export function usePendingWorkouts() {
  const { sync } = useServices();
  return useQuery({ queryKey: workoutKeys.outbox, queryFn: () => sync.pending(), staleTime: 0 });
}

/** Renders the server's explanation steps compactly (e.g. "base 10 · duration_bonus 20 · diminishing ×1"). */
export function explainPoints(explanation: PointsEntry['explanation']): string {
  if (!explanation || typeof explanation !== 'object') return '';
  const steps = (explanation.steps ?? []).map((s) => `${s.label} ${s.value}`).join(' · ');
  const caps = (explanation.caps ?? []).filter((c) => c.applied).map((c) => `${c.label} ${c.value}`).join(' · ');
  return [steps, caps, !steps && explanation.formula ? String(explanation.formula) : ''].filter(Boolean).join(' · ');
}

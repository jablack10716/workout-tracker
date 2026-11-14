import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { SetType } from '../utils/analyticsEngine';

export type { SetType };

export interface ActiveWorkoutSet {
  set_number: number;
  weight: string;
  reps: string;
  prev_performance?: string;
  is_completed: boolean;
  set_type?: SetType;
  rir?: number | null;
}

export interface ActiveWorkoutExercise {
  routine_exercise_id: string;
  exercise_id: string;
  name: string;
  default_rest_timer_seconds: number;
  is_bodyweight_only: boolean;
  prev_performance?: string;
  next_target_weight: string;
  is_target_weight_manually_edited?: boolean;
  next_target_reps?: string;
  is_target_reps_manually_edited?: boolean;
  target_rep_min?: number | null;
  target_rep_max?: number | null;
  is_swapped?: boolean;
  superset_id?: string | null;
  superset_order?: number;
  sets: ActiveWorkoutSet[];
}

export type ActiveWorkoutSyncStatus = 'in_progress' | 'pending_sync';

export interface ActiveWorkoutDraft {
  userId: string;
  routineId: string;
  routineName: string;
  routineDayId: string | null;
  dayNumber: number;
  dayName: string;
  cycleNumber: number;
  daysInSplit: number;
  cyclesPerRoutine: number;
  startedAtTimestamp: number;
  durationSeconds: number;
  workoutExercises: ActiveWorkoutExercise[];
  restTimerEndTimestamp: number | null;
  restTimerTotalSeconds: number | null;
  restTimerLabel?: string | null;
  syncStatus: ActiveWorkoutSyncStatus;
  savedSessionId?: string | null;
}

interface ActiveWorkoutStoreState {
  draft: ActiveWorkoutDraft | null;
  _hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;
  initializeDraft: (draft: ActiveWorkoutDraft) => void;
  updateWorkoutExercises: (
    updater: (prev: ActiveWorkoutExercise[]) => ActiveWorkoutExercise[]
  ) => void;
  setRestTimer: (
    endTimestamp: number | null,
    totalSeconds: number | null,
    label?: string | null
  ) => void;
  markPendingSync: (durationSeconds: number) => void;
  setSavedSessionId: (sessionId: string | null) => void;
  clearActiveWorkout: () => void;
}

/**
 * Crash-safe AsyncStorage-backed Zustand store holding the active or pending-sync workout session.
 */
export const useActiveWorkoutStore = create<ActiveWorkoutStoreState>()(
  persist(
    (set) => ({
      draft: null,
      _hasHydrated: false,
      setHasHydrated: (_hasHydrated) => set({ _hasHydrated }),
      initializeDraft: (draft) => set({ draft }),
      updateWorkoutExercises: (updater) =>
        set((state) => {
          if (!state.draft) return state;
          const nextExercises = updater(state.draft.workoutExercises);
          const elapsed = Math.max(
            Math.round((Date.now() - state.draft.startedAtTimestamp) / 1000),
            1
          );
          return {
            draft: {
              ...state.draft,
              workoutExercises: nextExercises,
              durationSeconds: elapsed,
            },
          };
        }),
      setRestTimer: (restTimerEndTimestamp, restTimerTotalSeconds, restTimerLabel) =>
        set((state) => {
          if (!state.draft) return state;
          return {
            draft: {
              ...state.draft,
              restTimerEndTimestamp,
              restTimerTotalSeconds,
              restTimerLabel: restTimerEndTimestamp ? restTimerLabel ?? 'Rest Timer' : null,
            },
          };
        }),
      markPendingSync: (durationSeconds) =>
        set((state) => {
          if (!state.draft) return state;
          return {
            draft: {
              ...state.draft,
              durationSeconds,
              restTimerEndTimestamp: null,
              restTimerTotalSeconds: null,
              restTimerLabel: null,
              syncStatus: 'pending_sync',
            },
          };
        }),
      setSavedSessionId: (savedSessionId) =>
        set((state) => {
          if (!state.draft) return state;
          return {
            draft: {
              ...state.draft,
              savedSessionId,
            },
          };
        }),
      clearActiveWorkout: () => set({ draft: null }),
    }),
    {
      name: 'weightlifting-active-workout-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ draft: state.draft }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

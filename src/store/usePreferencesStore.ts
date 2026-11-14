import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const EQUIPMENT_OPTIONS = [
  'dumbbell',
  'bodyweight',
  'pullup_dip_bar',
  'barbell',
  'cable',
  'machine',
  'kettlebell',
  'band',
] as const;

export type EquipmentType = (typeof EQUIPMENT_OPTIONS)[number];

export const EQUIPMENT_LABELS: Record<EquipmentType, string> = {
  dumbbell: 'Dumbbell',
  bodyweight: 'Bodyweight',
  pullup_dip_bar: 'Pull-Up / Dip Bar',
  barbell: 'Barbell',
  cable: 'Cable',
  machine: 'Machine',
  kettlebell: 'Kettlebell',
  band: 'Resistance Band',
};

export type RestDurationOption = 45 | 60 | 90 | 120 | 180;
export type SupersetTransitionSeconds = 0 | 15 | 30 | 45;

const VALID_REST_OPTIONS: readonly number[] = [45, 60, 90, 120, 180];
const VALID_TRANSITION_OPTIONS: readonly number[] = [0, 15, 30, 45];

interface PreferencesState {
  defaultRestSeconds: RestDurationOption;
  lockRestTimerToDefault: boolean;
  supersetTransitionSeconds: SupersetTransitionSeconds;
  hapticsEnabled: boolean;
  filterByMyGym: boolean;
  allowedEquipment: EquipmentType[];
  maxDumbbellWeightLbs: number | null;
  _hasHydrated: boolean;
  setDefaultRestSeconds: (seconds: RestDurationOption) => void;
  setLockRestTimerToDefault: (locked: boolean) => void;
  setSupersetTransitionSeconds: (seconds: SupersetTransitionSeconds) => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setFilterByMyGym: (enabled: boolean) => void;
  toggleAllowedEquipment: (eq: EquipmentType) => void;
  setAllowedEquipment: (equipment: EquipmentType[]) => void;
  setMaxDumbbellWeightLbs: (lbs: number | null) => void;
  setHasHydrated: (hydrated: boolean) => void;
}

/**
 * Persisted user preferences for rest timers, superset transition breathers, My Gym equipment filters, and DB caps.
 */
export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      defaultRestSeconds: 60,
      lockRestTimerToDefault: true,
      supersetTransitionSeconds: 0,
      hapticsEnabled: true,
      filterByMyGym: true,
      allowedEquipment: ['dumbbell', 'bodyweight'],
      maxDumbbellWeightLbs: 50,
      _hasHydrated: false,
      setDefaultRestSeconds: (defaultRestSeconds) => set({ defaultRestSeconds }),
      setLockRestTimerToDefault: (lockRestTimerToDefault) => set({ lockRestTimerToDefault }),
      setSupersetTransitionSeconds: (supersetTransitionSeconds) =>
        set({ supersetTransitionSeconds }),
      setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),
      setFilterByMyGym: (filterByMyGym) => set({ filterByMyGym }),
      toggleAllowedEquipment: (eq) =>
        set((state) => {
          const exists = state.allowedEquipment.includes(eq);
          if (exists) {
            return { allowedEquipment: state.allowedEquipment.filter((item) => item !== eq) };
          }
          return { allowedEquipment: [...state.allowedEquipment, eq] };
        }),
      setAllowedEquipment: (allowedEquipment) => set({ allowedEquipment }),
      setMaxDumbbellWeightLbs: (maxDumbbellWeightLbs) => set({ maxDumbbellWeightLbs }),
      setHasHydrated: (_hasHydrated) => set({ _hasHydrated }),
    }),
    {
      name: 'weightlifting-preferences-v1',
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      migrate: (persistedState: any, version: number) => {
        const s = (persistedState || {}) as Record<string, any>;
        if (version < 2) {
          const rawRest = Number(s.defaultRestSeconds);
          const upgradedRest: RestDurationOption =
            rawRest === 90 || !VALID_REST_OPTIONS.includes(rawRest)
              ? 60
              : (rawRest as RestDurationOption);

          const rawTransition = Number(s.supersetTransitionSeconds);
          const upgradedTransition: SupersetTransitionSeconds = VALID_TRANSITION_OPTIONS.includes(
            rawTransition
          )
            ? (rawTransition as SupersetTransitionSeconds)
            : 0;

          const validAllowed = Array.isArray(s.allowedEquipment)
            ? s.allowedEquipment.filter((e: any): e is EquipmentType =>
                EQUIPMENT_OPTIONS.includes(e)
              )
            : ['dumbbell', 'bodyweight'];

          return {
            ...s,
            defaultRestSeconds: upgradedRest,
            lockRestTimerToDefault:
              typeof s.lockRestTimerToDefault === 'boolean' ? s.lockRestTimerToDefault : true,
            supersetTransitionSeconds: upgradedTransition,
            hapticsEnabled: typeof s.hapticsEnabled === 'boolean' ? s.hapticsEnabled : true,
            filterByMyGym: typeof s.filterByMyGym === 'boolean' ? s.filterByMyGym : true,
            allowedEquipment: validAllowed,
            maxDumbbellWeightLbs:
              'maxDumbbellWeightLbs' in s ? s.maxDumbbellWeightLbs : 50,
          };
        }
        return s;
      },
      partialize: (state) => ({
        defaultRestSeconds: state.defaultRestSeconds,
        lockRestTimerToDefault: state.lockRestTimerToDefault,
        supersetTransitionSeconds: state.supersetTransitionSeconds,
        hapticsEnabled: state.hapticsEnabled,
        filterByMyGym: state.filterByMyGym,
        allowedEquipment: state.allowedEquipment,
        maxDumbbellWeightLbs: state.maxDumbbellWeightLbs,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

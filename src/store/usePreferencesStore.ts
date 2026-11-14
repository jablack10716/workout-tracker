import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type RestDurationOption = 60 | 90 | 120 | 180;
export type SupersetTransitionSeconds = 0 | 15 | 30 | 45;

interface PreferencesState {
  defaultRestSeconds: RestDurationOption;
  supersetTransitionSeconds: SupersetTransitionSeconds;
  hapticsEnabled: boolean;
  _hasHydrated: boolean;
  setDefaultRestSeconds: (seconds: RestDurationOption) => void;
  setSupersetTransitionSeconds: (seconds: SupersetTransitionSeconds) => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setHasHydrated: (hydrated: boolean) => void;
}

/**
 * Persisted user preferences for rest timers, superset transition breathers, and tactile feedback.
 */
export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      defaultRestSeconds: 90,
      supersetTransitionSeconds: 0,
      hapticsEnabled: true,
      _hasHydrated: false,
      setDefaultRestSeconds: (defaultRestSeconds) => set({ defaultRestSeconds }),
      setSupersetTransitionSeconds: (supersetTransitionSeconds) =>
        set({ supersetTransitionSeconds }),
      setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),
      setHasHydrated: (_hasHydrated) => set({ _hasHydrated }),
    }),
    {
      name: 'weightlifting-preferences-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        defaultRestSeconds: state.defaultRestSeconds,
        supersetTransitionSeconds: state.supersetTransitionSeconds,
        hapticsEnabled: state.hapticsEnabled,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type RestDurationOption = 60 | 90 | 120 | 180;

interface PreferencesState {
  defaultRestSeconds: RestDurationOption;
  hapticsEnabled: boolean;
  _hasHydrated: boolean;
  setDefaultRestSeconds: (seconds: RestDurationOption) => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setHasHydrated: (hydrated: boolean) => void;
}

/**
 * Persisted user preferences for rest timers and tactile feedback.
 */
export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      defaultRestSeconds: 90,
      hapticsEnabled: true,
      _hasHydrated: false,
      setDefaultRestSeconds: (defaultRestSeconds) => set({ defaultRestSeconds }),
      setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),
      setHasHydrated: (_hasHydrated) => set({ _hasHydrated }),
    }),
    {
      name: 'weightlifting-preferences-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        defaultRestSeconds: state.defaultRestSeconds,
        hapticsEnabled: state.hapticsEnabled,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

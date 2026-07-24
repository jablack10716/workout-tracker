import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { supabase } from '../src/lib/supabase';
import { Session } from '@supabase/supabase-js';
import { View, ActivityIndicator } from 'react-native';
import '../global.css';

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // Get initial session safely
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        setSession(session);
      })
      .catch((err) => {
        console.warn('Supabase session fetch warning (local DB might be starting or offline):', err);
      })
      .finally(() => {
        setInitialized(true);
      });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!initialized) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (session && inAuthGroup) {
      // User is signed in and trying to access auth screens, redirect to tabs
      router.replace('/(tabs)');
    } else if (!session && !inAuthGroup) {
      // User is not signed in and trying to access app screens, redirect to login
      router.replace('/(auth)/login');
    }
  }, [session, initialized, segments]);

  if (!initialized) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
      <Stack.Screen name="routine-builder/new" />
      <Stack.Screen name="workout/active" options={{ gestureEnabled: false }} />
      <Stack.Screen name="workout/complete" options={{ gestureEnabled: false }} />
      <Stack.Screen name="history/index" />
      <Stack.Screen name="history/[id]" />
      <Stack.Screen name="analytics/index" />
      <Stack.Screen name="exercises/[id]" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

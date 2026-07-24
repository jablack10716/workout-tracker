import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { X, User, Bell, LogOut, Check, Database } from 'lucide-react-native';

export default function SettingsScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [defaultTimer, setDefaultTimer] = useState(90);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user;
      if (user) {
        setEmail(user.email || '');
        setDisplayName(user.user_metadata?.display_name || '');
      }
    });
  }, []);

  async function handleSaveProfile() {
    setLoading(true);
    const { error } = await supabase.auth.updateUser({
      data: { display_name: displayName }
    });
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/(auth)/login');
  }

  return (
    <View className="flex-1 bg-slate-950 p-6 pt-12">
      {/* Modal Header */}
      <View className="flex-row justify-between items-center mb-8 border-b border-slate-800 pb-4">
        <Text className="text-white text-2xl font-bold">Settings</Text>
        <TouchableOpacity 
          onPress={() => router.back()} 
          className="w-10 h-10 bg-slate-800/80 rounded-full items-center justify-center"
        >
          <X color="#94a3b8" size={20} />
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1">
        {/* Profile Section */}
        <View className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800 mb-6">
          <View className="flex-row items-center mb-4">
            <User color="#3b82f6" size={20} className="mr-2" />
            <Text className="text-white text-lg font-bold">User Profile</Text>
          </View>

          <View className="mb-4">
            <Text className="text-slate-400 text-sm mb-1">Email</Text>
            <Text className="text-slate-300 bg-slate-800/40 p-3 rounded-xl border border-slate-800">{email}</Text>
          </View>

          <View className="mb-4">
            <Text className="text-slate-400 text-sm mb-1">Display Name</Text>
            <TextInput
              className="bg-slate-800 text-white p-3 rounded-xl border border-slate-700"
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              placeholderTextColor="#64748b"
            />
          </View>

          <TouchableOpacity 
            onPress={handleSaveProfile}
            disabled={loading}
            className="bg-blue-600 p-3 rounded-xl items-center flex-row justify-center mt-2"
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : saved ? (
              <>
                <Check color="white" size={18} className="mr-2" />
                <Text className="text-white font-bold">Saved!</Text>
              </>
            ) : (
              <Text className="text-white font-bold">Update Profile</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Rest Timer Preferences */}
        <View className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800 mb-6">
          <View className="flex-row items-center mb-4">
            <Bell color="#8b5cf6" size={20} className="mr-2" />
            <Text className="text-white text-lg font-bold">Rest Timer Defaults</Text>
          </View>

          <Text className="text-slate-400 text-sm mb-3">Default Rest Duration for New Exercises:</Text>
          <View className="flex-row justify-between mb-4">
            {[60, 90, 120, 180].map((seconds) => (
              <TouchableOpacity
                key={seconds}
                onPress={() => setDefaultTimer(seconds)}
                className={`px-4 py-2 rounded-xl border ${
                  defaultTimer === seconds 
                    ? 'bg-purple-600/30 border-purple-500' 
                    : 'bg-slate-800/40 border-slate-700/50'
                }`}
              >
                <Text className={`font-bold ${defaultTimer === seconds ? 'text-purple-300' : 'text-slate-400'}`}>
                  {seconds}s
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View className="flex-row justify-between items-center pt-2">
            <Text className="text-slate-300">Rest Timer Vibration</Text>
            <TouchableOpacity 
              onPress={() => setHapticsEnabled(!hapticsEnabled)}
              className={`w-12 h-7 rounded-full p-1 ${hapticsEnabled ? 'bg-purple-600' : 'bg-slate-700'}`}
            >
              <View className={`w-5 h-5 rounded-full bg-white ${hapticsEnabled ? 'ml-auto' : 'mr-auto'}`} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Database Health Badge */}
        <View className="bg-slate-900/60 p-4 rounded-2xl border border-slate-800 flex-row items-center justify-between mb-6">
          <View className="flex-row items-center">
            <Database color="#10b981" size={20} className="mr-3" />
            <View>
              <Text className="text-white font-semibold">Local Supabase DB</Text>
              <Text className="text-emerald-400 text-xs">Connected & Active</Text>
            </View>
          </View>
        </View>

        {/* Sign Out Action */}
        <TouchableOpacity 
          onPress={handleLogout}
          className="bg-red-500/10 border border-red-500/30 p-4 rounded-2xl flex-row items-center justify-center mb-10"
        >
          <LogOut color="#ef4444" size={20} className="mr-2" />
          <Text className="text-red-400 font-bold text-lg">Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

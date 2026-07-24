import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { supabase } from '../../src/lib/supabase';

export default function LoginScreen() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleAuth() {
    setErrorMessage('');
    const cleanEmail = email.trim();

    if (!cleanEmail) {
      setErrorMessage('Please enter your email address.');
      return;
    }

    if (!password || password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    setLoading(true);

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            display_name: displayName || cleanEmail.split('@')[0],
          },
        },
      });
      if (error) {
        setErrorMessage(error.message);
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (error) {
        setErrorMessage(error.message);
      }
    }
    setLoading(false);
  }

  return (
    <View className="flex-1 justify-center p-6 bg-slate-900">
      <View className="items-center mb-10">
        <Text className="text-3xl font-extrabold text-white text-center mb-2">
          Best Damn Weight Lifting Tracker Ever
        </Text>
        <Text className="text-slate-400 text-center">Track your progress, perfectly.</Text>
      </View>

      <View className="space-y-4">
        {isSignUp && (
          <View className="mb-4">
            <Text className="text-slate-400 mb-2">Display Name</Text>
            <TextInput
              className="bg-slate-800 text-white p-4 rounded-xl"
              placeholder="e.g. John Doe"
              placeholderTextColor="#64748b"
              value={displayName}
              onChangeText={setDisplayName}
            />
          </View>
        )}

        <View className="mb-4">
          <Text className="text-slate-400 mb-2">Email</Text>
          <TextInput
            className="bg-slate-800 text-white p-4 rounded-xl"
            placeholder="you@example.com"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
        </View>

        <View className="mb-4">
          <Text className="text-slate-400 mb-2">Password</Text>
          <TextInput
            className="bg-slate-800 text-white p-4 rounded-xl"
            placeholder="••••••••"
            placeholderTextColor="#64748b"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
        </View>

        {errorMessage ? (
          <View className="bg-red-500/20 border border-red-500/50 p-4 rounded-xl mb-4">
            <Text className="text-red-300 text-center font-medium">{errorMessage}</Text>
          </View>
        ) : null}

        <TouchableOpacity 
          className="bg-blue-600 p-4 rounded-xl mt-4 items-center"
          onPress={handleAuth}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-bold text-lg">{isSignUp ? 'Sign Up' : 'Log In'}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          className="p-4 items-center mt-2"
          onPress={() => setIsSignUp(!isSignUp)}
        >
          <Text className="text-slate-400">
            {isSignUp ? 'Already have an account? Log in' : "Don't have an account? Sign up"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

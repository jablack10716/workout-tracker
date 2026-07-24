import { supabase } from './supabase';

export async function ensureAuthenticated() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    return session.user;
  }

  // Auto-login or sign up for local development
  const email = 'dev@weightliftinglog.local';
  const password = 'password123';

  let { data, error } = await supabase.auth.signInWithPassword({ email, password });
  
  if (error) {
    // If user doesn't exist, sign up
    const signUpResponse = await supabase.auth.signUp({ email, password });
    if (signUpResponse.error) {
      console.error('Failed to auto-authenticate:', signUpResponse.error);
      return null;
    }
    return signUpResponse.data.user;
  }
  
  return data.user;
}

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export type Exercise = {
  id: string;
  name: string;
  is_bodyweight_only: boolean;
  default_rest_timer_seconds: number;
  exercise_muscle_groups?: Array<{ muscle_group: string; fraction: number }>;
};

export function useExercises() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchExercises = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('exercises')
      .select('*, exercise_muscle_groups(*)')
      .order('name');
    
    if (error) {
      console.error('Error fetching exercises:', error);
    } else {
      setExercises(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchExercises();
  }, []);

  return { exercises, loading, refetch: fetchExercises };
}

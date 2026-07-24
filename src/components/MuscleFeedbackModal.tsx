import React, { useState } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, Switch } from 'react-native';
import { MuscleGroup } from '../database/types';

export interface FeedbackData {
  muscle_group_id: string;
  pump_rating: number;
  soreness_rating: number;
  workload_rating: number;
  joint_integrity_flag: 0 | 1;
}

interface MuscleFeedbackModalProps {
  visible: boolean;
  muscleGroups: MuscleGroup[];
  onComplete: (feedback: FeedbackData[]) => void;
  onCancel: () => void;
}

export const MuscleFeedbackModal: React.FC<MuscleFeedbackModalProps> = ({
  visible,
  muscleGroups,
  onComplete,
  onCancel,
}) => {
  const [feedbackState, setFeedbackState] = useState<Record<string, FeedbackData>>({});

  const handleRating = (mgId: string, field: keyof FeedbackData, value: number) => {
    setFeedbackState((prev) => ({
      ...prev,
      [mgId]: {
        ...(prev[mgId] || {
          muscle_group_id: mgId,
          pump_rating: 2,
          soreness_rating: 2,
          workload_rating: 2,
          joint_integrity_flag: 0,
        }),
        [field]: value,
      },
    }));
  };

  const submit = () => {
    // Fill in default values for any missing muscle groups
    const result = muscleGroups.map(mg => {
      return feedbackState[mg.id] || {
        muscle_group_id: mg.id,
        pump_rating: 2,
        soreness_rating: 2,
        workload_rating: 2,
        joint_integrity_flag: 0,
      };
    });
    onComplete(result);
  };

  const renderRatingRow = (mgId: string, label: string, field: keyof FeedbackData) => {
    const currentVal = feedbackState[mgId]?.[field] || 2;
    return (
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-gray-700">{label}</Text>
        <View className="flex-row gap-2">
          {[1, 2, 3].map((val) => (
            <TouchableOpacity
              key={val}
              onPress={() => handleRating(mgId, field, val)}
              className={`w-10 h-10 rounded items-center justify-center ${currentVal === val ? 'bg-blue-500' : 'bg-gray-200'}`}
            >
              <Text className={currentVal === val ? 'text-white font-bold' : 'text-gray-700'}>{val}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View className="flex-1 bg-white p-4">
        <Text className="text-2xl font-bold mb-4">Post-Workout Feedback</Text>
        <Text className="text-gray-500 mb-4">Rate 1 (Low/Easy) to 3 (High/Hard)</Text>

        <ScrollView className="flex-1">
          {muscleGroups.map((mg) => (
            <View key={mg.id} className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <Text className="text-lg font-bold mb-2">{mg.name}</Text>
              
              {renderRatingRow(mg.id, 'Pump Quality', 'pump_rating')}
              {renderRatingRow(mg.id, 'Soreness', 'soreness_rating')}
              {renderRatingRow(mg.id, 'Workload Perception', 'workload_rating')}
              
              <View className="flex-row items-center justify-between mt-2 pt-2 border-t border-gray-200">
                <Text className="text-red-500 font-semibold">Joint Pain / Integrity Issue?</Text>
                <Switch
                  value={feedbackState[mg.id]?.joint_integrity_flag === 1}
                  onValueChange={(val) => handleRating(mg.id, 'joint_integrity_flag', val ? 1 : 0)}
                />
              </View>
            </View>
          ))}
        </ScrollView>

        <View className="flex-row gap-4 mt-4">
          <TouchableOpacity onPress={onCancel} className="flex-1 p-4 bg-gray-200 rounded-lg items-center">
            <Text className="font-bold text-gray-700">Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={submit} className="flex-1 p-4 bg-blue-600 rounded-lg items-center">
            <Text className="font-bold text-white">Submit Feedback</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

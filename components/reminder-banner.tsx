"use client";
import type { ReminderState } from "@/lib/dashboard";
export function ReminderBanner({
  reminder,
  onGoImport,
}: {
  reminder: ReminderState;
  onGoImport: () => void;
}) {
  void reminder;
  void onGoImport;
  return null;
}

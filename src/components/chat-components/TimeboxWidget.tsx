/* eslint-disable */
import React, { useState } from "react";
import { Notice } from "obsidian";
import { GoogleCalendarService } from "@/services/googleCalendarService";

export interface TimeboxEvent {
  summary: string;
  start: string; // ISO String
  end: string; // ISO String
  isExisting?: boolean; // If true, it's already on GCal (read-only)
}

export interface TimeboxWidgetProps {
  events: TimeboxEvent[];
  date: string; // YYYY-MM-DD
}

export const TimeboxWidget: React.FC<TimeboxWidgetProps> = ({ events, date }) => {
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(
    new Set(events.map((e, i) => (e.isExisting ? -1 : i)).filter((i) => i !== -1))
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSynced, setIsSynced] = useState(false);

  // Sort events chronologically
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );

  const toggleTask = (index: number) => {
    const newSelected = new Set(selectedTasks);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedTasks(newSelected);
  };

  const handleSync = async () => {
    // Sync ALL events in the schedule (existing + new) so the full day is replaced
    const allEvents = sortedEvents.map((e) => ({
      summary: e.summary,
      start: e.start,
      end: e.end,
    }));
    if (allEvents.length === 0) return;

    setIsSyncing(true);
    const service = GoogleCalendarService.getInstance();

    if (typeof service.createEvents === "function") {
      const success = await service.createEvents(allEvents, date);
      if (success) {
        setIsSynced(true);
      }
    } else {
      new Notice("Calendar sync coming soon!");
      setIsSynced(true);
    }
    setIsSyncing(false);
  };

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="tw-my-4 tw-rounded-xl tw-border tw-border-white/10 tw-bg-white/5 tw-p-5 tw-backdrop-blur-md tw-shadow-2xl">
      <div className="tw-mb-4 tw-flex tw-items-center tw-justify-between border-b tw-border-white/10 tw-pb-3">
        <h3 className="tw-text-lg tw-font-semibold tw-text-white tw-tracking-tight">
          Time-Box Schedule
        </h3>
        <span className="tw-text-sm tw-font-medium tw-text-gray-400">{date}</span>
      </div>

      <div className="tw-space-y-3 tw-mb-6">
        {sortedEvents.map((event, i) => {
          const isExisting = event.isExisting;
          const isSelected = selectedTasks.has(i);

          return (
            <div
              key={i}
              className={`tw-flex tw-items-center tw-justify-between tw-rounded-lg tw-p-3 tw-transition-all tw-duration-300 ${
                isExisting
                  ? "tw-bg-gray-800/40 tw-text-gray-400 tw-border tw-border-gray-700/50"
                  : isSelected
                    ? "tw-bg-gradient-to-r tw-from-indigo-500/20 tw-to-purple-500/20 tw-border tw-border-indigo-500/30 tw-text-indigo-100"
                    : "tw-bg-gray-800/40 tw-text-gray-500 tw-border tw-border-gray-700/50"
              } hover:tw-scale-[1.01]`}
            >
              <div className="tw-flex tw-items-center tw-gap-4">
                <div className="tw-flex tw-flex-col tw-text-xs tw-font-medium tw-opacity-80">
                  <span>{formatTime(event.start)}</span>
                  <span className="tw-opacity-50">to</span>
                  <span>{formatTime(event.end)}</span>
                </div>
                <div className="tw-font-medium tw-text-sm">{event.summary}</div>
              </div>

              {!isExisting && (
                <button
                  onClick={() => toggleTask(i)}
                  className={`tw-flex tw-h-5 tw-w-5 tw-items-center tw-justify-center tw-rounded tw-border tw-transition-colors ${
                    isSelected
                      ? "tw-bg-indigo-500 tw-border-indigo-500 tw-text-white"
                      : "tw-border-gray-500 tw-bg-transparent"
                  }`}
                >
                  {isSelected && (
                    <svg
                      className="tw-h-3.5 tw-w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={3}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </button>
              )}
              {isExisting && (
                <div className="tw-text-xs tw-uppercase tw-tracking-wider tw-text-gray-500 tw-font-semibold tw-flex tw-items-center tw-gap-1">
                  <svg
                    className="tw-h-3 tw-w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  GCal
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={handleSync}
        disabled={isSyncing || isSynced || sortedEvents.length === 0}
        className={`tw-w-full tw-rounded-lg tw-px-4 tw-py-3 tw-font-semibold tw-text-white tw-transition-all tw-duration-300 ${
          isSynced
            ? "tw-bg-emerald-500/20 tw-text-emerald-400 tw-border tw-border-emerald-500/30"
            : sortedEvents.length === 0
              ? "tw-bg-gray-800 tw-text-gray-500 tw-cursor-not-allowed"
              : "tw-bg-gradient-to-r tw-from-indigo-600 tw-via-purple-600 tw-to-pink-600 hover:tw-opacity-90 active:tw-scale-[0.98] tw-shadow-lg tw-shadow-indigo-500/25"
        }`}
      >
        {isSyncing ? (
          <span className="tw-flex tw-items-center tw-justify-center tw-gap-2">
            <svg className="tw-h-5 tw-w-5 tw-animate-spin" viewBox="0 0 24 24" fill="none">
              <circle
                className="tw-opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="tw-opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            Replacing day...
          </span>
        ) : isSynced ? (
          <span className="tw-flex tw-items-center tw-justify-center tw-gap-2">
            <svg className="tw-h-5 tw-w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            Synchronized to Google Calendar
          </span>
        ) : (
          `Replace ${date} with ${sortedEvents.length} events`
        )}
      </button>
    </div>
  );
};

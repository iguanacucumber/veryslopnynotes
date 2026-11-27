// Barrel de compatibilité : les écrans de l'accueil et de l'EDT importent ici.
export { MAX_ITEMS, boundedText, millisOf } from "./payload";
export { civilDayOffset, parisDayKeyOf } from "./calendar";
export {
  TIMETABLE_UNAVAILABLE,
  TIMETABLE_UNREADABLE,
  isCancelled,
  isMoved,
  isTimetablePayloadReadable,
  isUpcomingLesson,
  parseTimetable,
  upcomingCount,
  upcomingLessons,
} from "./timetable";
export type { Lesson, LessonStatus } from "./timetable";
export {
  isPendingTask,
  isUpcomingTask,
  parseAssignments,
  pendingAssignments,
  pendingCount,
} from "./assignments";
export type { Assignment } from "./assignments";
export {
  estimatedAverageSeries,
  formatAverage,
  formatGrade,
  generalAverage,
  latestGrades,
  parseGrades,
  providedGeneralAverage,
  subjectAverage,
} from "./grades";
export type { GeneralAverage, Grade, GradeSummary } from "./grades";
export { alertCountLabel, parseAlerts, parseCapabilities, tabVisible } from "./alerts";
export type { Alert } from "./alerts";
export { ENTRANCE_WINDOW_MS, shouldAnimateOnMount } from "./entrance";
export {
  clockLabel,
  countdownFr,
  courseCountdown,
  courseWidgetTitle,
  dayLabel,
  dayOffset,
  dueLabel,
  durationLabel,
  movedHint,
  timeRange,
} from "./labels";

// Logique pure de l'écran Tâches, portée de `AssignmentsSections.kt` et
// `AssignmentsRepository.kt`. Aucun React, aucun réseau : les parsers et les
// regroupements sont testables avec un `now` injecté.

export {
  ASSIGNMENTS_MAX_ITEMS,
  ASSIGNMENTS_MAX_SCAN,
  ASSIGNMENTS_UNAVAILABLE,
  ASSIGNMENTS_UNREADABLE,
  allAssignmentAttachments,
  isAssignmentsPayloadReadable,
  parseAssignment,
  parseAssignmentsPayload,
} from "./assignment-parse";
export type {
  Assignment,
  AssignmentAttachment,
  AssignmentLessonContent,
  AssignmentsPayload,
} from "./assignment-parse";

export {
  assignmentDate,
  assignmentDayKey,
  assignmentsInWeek,
  isAllDayDue,
  isoWeekNumber,
  shiftWeek,
  taskWeekSuffixFr,
  weekEndOf,
  weekGap,
  weekLabelFr,
  weekRangeFr,
  weekStartOf,
} from "./assignment-time";

export {
  assignmentSectionOf,
  assignmentSections,
  assignmentsMatching,
  overdueCount,
  taskProgress,
} from "./assignment-sections";
export type { AssignmentSection, AssignmentSectionId } from "./assignment-sections";

export {
  assignmentCardText,
  assignmentHasAssistantMaterial,
  dueLabel,
  foldFr,
  subjectDisplayFr,
  subjectInitial,
} from "./assignment-labels";

export {
  HOMEWORK_FOLLOW_UP_CHARS,
  aiContextTypeFr,
  homeworkFollowUpQuestion,
  homeworkRefusalText,
  parseAiContext,
  parseHomeworkActions,
  parseHomeworkAnswer,
} from "./assignment-homework";
export type { HomeworkAction, HomeworkAnswer, HomeworkExchange } from "./assignment-homework";

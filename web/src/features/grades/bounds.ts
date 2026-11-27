// Bornes de lecture, mêmes valeurs que le Kotlin.
export const MAX_SUBJECT_CHARS = 100;
export const MAX_LABEL_CHARS = 200;
export const MAX_TEACHER_CHARS = 100;
export const MAX_PERIOD_NAME_CHARS = 100;
export const MAX_ID_CHARS = 64;
export const MAX_AVERAGE_POINTS = 200;
// Bornes de rendu propres au web : un payload corrompu ne fait pas rendre
// des milliers de lignes.
export const MAX_GRADES = 5000;
export const MAX_PERIODS = 200;

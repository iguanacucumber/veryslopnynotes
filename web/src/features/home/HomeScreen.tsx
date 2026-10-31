import { useMemo, useState, type ComponentType, type ReactElement } from "react";
import { useViewNavigate as useNavigate } from "../../ui/viewTransition";
import { relativeFr, subjectColor, tint } from "../../lib/format";
import { subjectEmoji } from "../../lib/subjectVisual";
import { useApp, useResource } from "../../ui/AppContext";
import { Card, EmptyState, ErrorBox, Loading, Page, StaleBadge } from "../../ui/components";
import {
  IconArrowRightUp,
  IconCalendar,
  IconFood,
  IconGrades,
  IconMessage,
  IconNews,
  IconPin,
  IconTasks,
  IconUser,
  IconWarning,
} from "../../ui/icons";
import { Sparkline } from "../grades/components";
import {
  clockLabel,
  courseCountdown,
  courseWidgetTitle,
  dayLabel,
  dueLabel,
  formatAverage,
  generalAverage,
  parseAssignments,
  parseCapabilities,
  parseGrades,
  parseTimetable,
  pendingAssignments,
  pendingCount,
  shouldAnimateOnMount,
  tabVisible,
  upcomingCount,
  upcomingLessons,
  type GeneralAverage,
  type Grade,
  type Lesson,
  type Assignment,
} from "./parse";
import { useNow } from "./useNow";
import { ManualPrompt } from "../settings/ManualPrompt";
import "./home.css";

type IconComponent = ComponentType<{ size?: number }>;

/** Décision d'entrée FIGÉE au montage : celui qui arrive après la fenêtre de
 *  fraîcheur apparaît SANS entrée, et la classe n'est jamais retirée. */
function useEntrance(openedAt: number): boolean {
  const [animate] = useState(() => shouldAnimateOnMount(openedAt, Date.now()));
  return animate;
}

interface Palette {
  base: string;
  background: string;
  ink: string;
}

/** Mêmes pas que `Course.tsx` de Papillon : fond teinté, encre décalée. */
function paletteFor(subject: string, dark: boolean): Palette {
  const base = subjectColor(subject);
  return {
    base,
    background: tint(base, dark ? -0.7 : 0.75),
    ink: tint(base, dark ? 0.1 : -0.15),
  };
}

function WidgetHeader({
  title,
  icon,
  onMore,
}: {
  title: string;
  icon?: ReactElement;
  onMore?: () => void;
}) {
  return (
    <div className="home-widget__header">
      {icon ? <span className="home-widget__icon">{icon}</span> : null}
      <h2 className="home-widget__title">{title}</h2>
      {onMore ? (
        <button type="button" className="home-widget__more" onClick={onMore} aria-label={`${title} — tout voir`}>
          Afficher plus
          <IconArrowRightUp size={20} />
        </button>
      ) : null}
    </div>
  );
}

function AverageWidget({
  average,
  history,
  onMore,
  openedAt,
}: {
  average: GeneralAverage;
  history: Array<number | null>;
  onMore: () => void;
  openedAt: number;
}) {
  const animate = useEntrance(openedAt);
  const value = average.value;
  return (
    <Card className={animate ? "home-widget home-rise" : "home-widget"}>
      <WidgetHeader title="Moyenne" icon={<IconGrades size={24} />} onMore={onMore} />
      {value !== null ? (
        <div
          className="home-average"
          aria-label={`Moyenne générale ${formatAverage(value)} sur 20, ${
            average.provided ? "fournie par l’établissement" : "estimée"
          }`}
        >
          <div className="home-average__graph" aria-hidden="true">
            <Sparkline values={history} provided={average.provided} />
          </div>
          <div className="home-average__body">
            <div className="home-average__figure" aria-hidden="true">
              <strong>{formatAverage(value)}</strong>
              <span>/20</span>
            </div>
            <span className="home-average__label">Moyenne des matières</span>
            <span className="home-average__origin">
              {average.provided ? "par l’établissement" : "estimée sur la période"}
            </span>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function CourseWidget({
  lessons,
  now,
  dark,
  onMore,
  openedAt,
}: {
  lessons: Lesson[];
  now: number;
  dark: boolean;
  onMore: () => void;
  openedAt: number;
}) {
  const animate = useEntrance(openedAt);
  return (
    <Card className={animate ? "home-widget home-rise" : "home-widget"}>
      <WidgetHeader
        title={courseWidgetTitle(lessons[0], now)}
        icon={<IconCalendar size={24} />}
        onMore={onMore}
      />
      <div className="home-courses">
        {lessons.map((lesson) => {
          const palette = paletteFor(lesson.subject, dark);
          const countdown = courseCountdown(lesson, now);
          const live = lesson.start <= now && now < lesson.end;
          return (
            <div className={`home-course${live ? " home-course--live" : ""}`} key={lesson.id}>
              <div className="home-course__time" aria-hidden="true">
                <strong>{clockLabel(lesson.start)}</strong>
                <span>{clockLabel(lesson.end)}</span>
              </div>
              <div
                className="home-course__card"
                style={{ background: palette.background, color: palette.ink }}
              >
                <span className="home-course__bar" style={{ background: palette.ink }} aria-hidden="true" />
                <div className="home-course__body">
                  <strong className="home-course__subject">{lesson.subject}</strong>
                  <span className="home-course__meta">
                    <IconPin size={20} />
                    <span>{lesson.room || "Salle non précisée"}</span>
                    {lesson.teacher ? (
                      <>
                        <span className="home-course__separator" aria-hidden="true" />
                        <IconUser size={20} />
                        <span>{lesson.teacher}</span>
                      </>
                    ) : null}
                  </span>
                  {countdown ? <span className="home-course__hint">{countdown}</span> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function TasksWidget({
  tasks,
  total,
  now,
  dark,
  onMore,
  openedAt,
}: {
  tasks: Assignment[];
  total: number;
  now: number;
  dark: boolean;
  onMore: () => void;
  openedAt: number;
}) {
  const animate = useEntrance(openedAt);
  return (
    <Card className={animate ? "home-widget home-rise" : "home-widget"}>
      <WidgetHeader title="Devoirs" icon={<IconTasks size={24} />} onMore={onMore} />
      <span className="sr-only">{total} devoirs à faire</span>
      <div className="home-tasks">
        {tasks.map((task) => {
          const palette = paletteFor(task.subject, dark);
          return (
            <div className="home-task" key={task.id}>
              <span className="home-task__emoji" aria-hidden="true">
                {subjectEmoji(task.subject)}
              </span>
              <div className="grow">
                <div className="home-task__row">
                  <span className="home-task__subject" style={{ color: palette.ink }}>
                    {task.subject}
                  </span>
                  <span className="home-task__due">{dueLabel(task.due, now)}</span>
                </div>
                <div className="home-task__title">{task.title}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

interface QuickAction {
  to: string;
  label: string;
  status: string;
  icon: IconComponent;
  tone: "news" | "canteen" | "attendance" | "messages";
  tab?: string;
}

/** Couleurs fixes des tuiles Papillon, posées en CSS par `tone`. */
const QUICK_ACTIONS: QuickAction[] = [
  { to: "/news", label: "Actualités", status: "Établissement", icon: IconNews, tone: "news", tab: "news" },
  { to: "/canteen", label: "Cantine", status: "Menus", icon: IconFood, tone: "canteen", tab: "menus" },
  { to: "/attendance", label: "Vie scolaire", status: "Absences", icon: IconWarning, tone: "attendance", tab: "attendance" },
  { to: "/messages", label: "Messagerie", status: "Discussions", icon: IconMessage, tone: "messages", tab: "discussions" },
];

function QuickActions({
  capabilities,
  openedAt,
}: {
  capabilities: string[] | null;
  openedAt: number;
}) {
  const navigate = useNavigate();
  const animate = useEntrance(openedAt);
  const actions = QUICK_ACTIONS.filter((action) => !action.tab || tabVisible(capabilities, action.tab));
  if (actions.length === 0) return null;
  return (
    <div className="home-actions">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            type="button"
            className={`home-action home-action--${action.tone}${animate ? " home-rise" : ""}`}
            key={action.to}
            onClick={() => navigate(action.to)}
            aria-label={`${action.label} — ${action.status}`}
          >
            <span className="home-action__icon" aria-hidden="true">
              <Icon size={32} />
            </span>
            <span className="home-action__text">
              <span className="home-action__label">{action.label}</span>
              <span className="home-action__status">{action.status}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function HomeScreen() {
  const navigate = useNavigate();
  const { dark } = useApp();
  const now = useNow();
  // Ouverture de l'écran figée au montage : un élément monté après la fenêtre de
  // fraîcheur apparaît SANS entrée.
  const [openedAt] = useState(() => Date.now());
  const gradesRes = useResource("grades");
  const assignmentsRes = useResource("assignments");
  const timetableRes = useResource("timetable");
  const capabilitiesRes = useResource("capabilities");

  const grades = useMemo(() => parseGrades(gradesRes.payload), [gradesRes.payload]);
  const average = useMemo(() => generalAverage(gradesRes.payload, grades), [gradesRes.payload, grades]);
  const averageHistory = useMemo(() => cumulativeHistory(grades), [grades]);
  const lessons = useMemo(() => parseTimetable(timetableRes.payload), [timetableRes.payload]);
  // La liste des widgets reste BORNÉE (deux cours) ; le compteur est le nombre
  // VRAI, sans plafond.
  const upcoming = useMemo(() => upcomingLessons(lessons, now, 2), [lessons, now]);
  const upcomingTotal = useMemo(() => upcomingCount(lessons, now), [lessons, now]);
  const assignments = useMemo(
    () => parseAssignments(assignmentsRes.payload),
    [assignmentsRes.payload],
  );
  const tasks = useMemo(() => pendingAssignments(assignments, now, 2), [assignments, now]);
  // Un devoir en retard reste un devoir À FAIRE : il compte.
  const tasksTotal = useMemo(() => pendingCount(assignments), [assignments]);
  const capabilities = useMemo(
    () => parseCapabilities(capabilitiesRes.payload),
    [capabilitiesRes.payload],
  );

  const resources = [gradesRes, assignmentsRes, timetableRes, capabilitiesRes];
  const dataResources = [gradesRes, assignmentsRes, timetableRes];
  const loading = !resources.some((resource) => resource.payload) && resources.some((r) => r.loading);
  const error = dataResources.map((resource) => resource.error).find(Boolean) ?? null;
  const stale = dataResources.some((resource) => resource.stale);
  const stamps = dataResources
    .filter((resource) => resource.payload && resource.fetchedAt > 0)
    .map((resource) => resource.fetchedAt);
  const oldest = stamps.length > 0 ? Math.min(...stamps) : 0;
  const staleLabel = oldest
    ? `hors-ligne · mis à jour ${relativeFr(new Date(oldest).toISOString())}`
    : "hors-ligne";
  const showGrades = tabVisible(capabilities, "grades");
  const showHomework = tabVisible(capabilities, "homework");
  const showTimetable = tabVisible(capabilities, "timetable");
  const hasData =
    average.value !== null || grades.length > 0 || upcomingTotal > 0 || tasksTotal > 0;
  const refreshAll = () => resources.forEach((resource) => resource.refresh());

  return (
    <Page className="home">
      <ManualPrompt />
      {hasData && (stale || error) ? (
        <div className="home-status" role="status">
          <StaleBadge label={staleLabel} />
          {error ? <span className="tiny muted">Affichage du cache · {error}</span> : null}
        </div>
      ) : null}

      {loading ? <Loading label="Chargement de l’accueil…" /> : null}

      {!loading && !hasData && error ? (
        <ErrorBox message={error}>
          <button type="button" className="btn btn--small" onClick={refreshAll}>
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      {!loading && !hasData && !error ? (
        <EmptyState
          icon={<IconCalendar size={30} />}
          title="Rien à afficher"
          body="Aucune donnée en cache. Appaire l’établissement puis actualise un onglet."
          action={
            <button type="button" className="btn btn--small" onClick={refreshAll}>
              Actualiser
            </button>
          }
        />
      ) : null}

      <QuickActions capabilities={capabilities} openedAt={openedAt} />

      {!loading && showTimetable && upcoming.length > 0 ? (
        <CourseWidget
          lessons={upcoming}
          now={now}
          dark={dark}
          onMore={() => navigate("/calendar")}
          openedAt={openedAt}
        />
      ) : null}

      {!loading && showGrades && average.value !== null ? (
        <AverageWidget
          average={average}
          history={averageHistory}
          onMore={() => navigate("/grades")}
          openedAt={openedAt}
        />
      ) : null}

      {!loading && showHomework && tasks.length > 0 ? (
        <TasksWidget
          tasks={tasks}
          total={tasksTotal}
          now={now}
          dark={dark}
          onMore={() => navigate("/tasks")}
          openedAt={openedAt}
        />
      ) : null}


      {scheduleHint(upcoming[0], now)}
    </Page>
  );
}

/** Tendance lisible : moyenne cumulée des notes, de la plus ancienne à la plus
 *  récente. Le graphe Papillon suit l'historique ; sans lui, cette marche
 *  donne la même pente sans inventer de points. */
function cumulativeHistory(grades: Grade[]): Array<number | null> {
  const sorted = [...grades].sort((a, b) => a.date - b.date).slice(-40);
  let sum = 0;
  return sorted.map((grade, index) => {
    sum += (grade.value / grade.scale) * 20;
    return sum / (index + 1);
  });
}

function scheduleHint(lesson: Lesson | undefined, now: number): ReactElement | null {
  if (!lesson || lesson.start > now || now >= lesson.end) return null;
  return (
    <p className="home-footnote tiny muted">
      En cours jusqu’à {clockLabel(lesson.end)} · {dayLabel(lesson.start, now)}
    </p>
  );
}

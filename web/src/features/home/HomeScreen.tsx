import { useMemo, useState, type ComponentType, type ReactElement } from "react";
import { useViewNavigate as useNavigate } from "../../ui/viewTransition";
import { relativeFr, subjectColor, tint } from "../../lib/format";
import { useApp, useResource } from "../../ui/AppContext";
import { Card, EmptyState, ErrorBox, Loading, Page, StaleBadge } from "../../ui/components";
import {
  IconCalendar,
  IconChevronRight,
  IconFood,
  IconGrades,
  IconMessage,
  IconNews,
  IconTasks,
  IconWarning,
} from "../../ui/icons";
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

/** Pastel de matière + encre mesurée, mêmes pas que Compose. */
function paletteFor(subject: string, dark: boolean): Palette {
  const base = subjectColor(subject);
  return {
    base,
    background: tint(base, dark ? -0.74 : 0.86),
    ink: tint(base, dark ? 0.72 : -0.5),
  };
}

function WidgetHeader({
  title,
  icon,
  count,
  onMore,
}: {
  title: string;
  icon?: ReactElement;
  count?: number;
  onMore?: () => void;
}) {
  return (
    <div className="home-widget__header">
      {icon ? <span className="home-widget__icon">{icon}</span> : null}
      <h2 className="home-widget__title">{title}</h2>
      {typeof count === "number" ? <span className="home-widget__count">{count}</span> : null}
      {onMore ? (
        <button type="button" className="home-widget__more" onClick={onMore} aria-label={`${title} — tout voir`}>
          Afficher plus
          <IconChevronRight size={14} />
        </button>
      ) : null}
    </div>
  );
}

function AverageWidget({
  average,
  onMore,
  openedAt,
}: {
  average: GeneralAverage;
  onMore: () => void;
  openedAt: number;
}) {
  const animate = useEntrance(openedAt);
  const value = average.value;
  const fraction = value === null ? 0 : Math.max(0, Math.min(1, value / 20));
  return (
    <Card className={animate ? "home-widget home-rise" : "home-widget"}>
      <WidgetHeader title="Moyenne" icon={<IconGrades size={18} />} onMore={onMore} />
      {value !== null ? (
        <div
          className="home-average"
          aria-label={`Moyenne générale ${formatAverage(value)} sur 20, ${
            average.provided ? "fournie par l’établissement" : "estimée"
          }`}
        >
          <div className="home-average__figure" aria-hidden="true">
            <strong>{formatAverage(value)}</strong>
            <span>/20</span>
          </div>
          <div className="home-average__copy">
            <span className="home-average__origin">
              {average.provided ? "Moyenne des matières" : "Estimation sur la période"}
            </span>
            {average.subjectCount > 0 ? (
              <span className="home-average__count">{average.subjectCount} matières suivies</span>
            ) : null}
          </div>
          <span className="home-average__meter" aria-hidden="true">
            <span style={{ width: `${fraction * 100}%` }} />
          </span>
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
        icon={<IconCalendar size={18} />}
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
                style={{
                  background: palette.background,
                  color: palette.ink,
                  borderLeftColor: palette.base,
                }}
              >
                <strong className="home-course__subject">{lesson.subject}</strong>
                <span className="home-course__room">
                  {lesson.room ? `Salle ${lesson.room}` : "Salle non précisée"}
                </span>
                {countdown ? <span className="home-course__hint">{countdown}</span> : null}
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
      <WidgetHeader
        title="Devoirs"
        icon={<IconTasks size={18} />}
        count={total}
        onMore={onMore}
      />
      <div className="home-tasks">
        {tasks.map((task) => {
          const palette = paletteFor(task.subject, dark);
          return (
            <div className="home-task" key={task.id}>
              <span className="home-task__mark" style={{ background: palette.base }} aria-hidden="true" />
              <div className="grow">
                <div className="home-task__subject" style={{ color: palette.ink }}>
                  {task.subject}
                </div>
                <div className="home-task__title">{task.title}</div>
              </div>
              <span className={`home-task__due ${dueTone(task.due, now)}`}>
                {dueLabel(task.due, now)}
              </span>
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
  tab?: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { to: "/news", label: "Actualités", status: "Établissement", icon: IconNews, tab: "news" },
  { to: "/canteen", label: "Cantine", status: "Menus", icon: IconFood, tab: "menus" },
  { to: "/attendance", label: "Vie scolaire", status: "Absences", icon: IconWarning, tab: "attendance" },
  { to: "/messages", label: "Messagerie", status: "Discussions", icon: IconMessage, tab: "discussions" },
];

function QuickActions({
  capabilities,
  openedAt,
  dark,
}: {
  capabilities: string[] | null;
  openedAt: number;
  dark: boolean;
}) {
  const navigate = useNavigate();
  const animate = useEntrance(openedAt);
  const actions = QUICK_ACTIONS.filter((action) => !action.tab || tabVisible(capabilities, action.tab));
  if (actions.length === 0) return null;
  return (
    <div className="home-actions">
      {actions.map((action) => {
        const Icon = action.icon;
        const palette = paletteFor(action.label, dark);
        return (
          <button
            type="button"
            className={animate ? "home-action home-rise" : "home-action"}
            key={action.to}
            onClick={() => navigate(action.to)}
            aria-label={`${action.label} — ${action.status}`}
          >
            <span className="home-action__icon" style={{ color: palette.ink }} aria-hidden="true">
              <Icon size={22} />
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

      <QuickActions capabilities={capabilities} openedAt={openedAt} dark={dark} />

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

/** Teinte d'échéance : rouge sous 24 h, accent sous 72 h, neutre ensuite. */
function dueTone(due: number, now: number): string {
  if (!due) return "";
  const hours = (due - now) / 3_600_000;
  if (hours <= 24) return "home-task__due--soon";
  if (hours <= 72) return "home-task__due--near";
  return "";
}

function scheduleHint(lesson: Lesson | undefined, now: number): ReactElement | null {
  if (!lesson || lesson.start > now || now >= lesson.end) return null;
  return (
    <p className="home-footnote tiny muted">
      En cours jusqu’à {clockLabel(lesson.end)} · {dayLabel(lesson.start, now)}
    </p>
  );
}

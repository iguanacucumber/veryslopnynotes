import { useMemo, type ComponentType, type CSSProperties, type ReactElement } from "react";
import { useViewNavigate as useNavigate } from "../../ui/viewTransition";
import { frDate, relativeFr, subjectColor, tint } from "../../lib/format";
import { subjectEmoji } from "../../lib/subjectVisual";
import { useApp, useResource } from "../../ui/AppContext";
import {
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  Page,
  Section,
  StaleBadge,
  SubjectAvatar,
} from "../../ui/components";
import {
  IconBell,
  IconBook,
  IconCalendar,
  IconChevronRight,
  IconFood,
  IconGrades,
  IconMessage,
  IconSettings,
  IconShield,
  IconTasks,
  IconWarning,
} from "../../ui/icons";
import {
  alertCountLabel,
  clockLabel,
  countAlerts,
  courseCountdown,
  courseWidgetTitle,
  dayLabel,
  dueLabel,
  formatAverage,
  generalAverage,
  latestGrades,
  parseAssignments,
  parseCapabilities,
  parseGrades,
  parseTimetable,
  pendingAssignments,
  tabVisible,
  timeRange,
  upcomingLessons,
  type GeneralAverage,
  type GradeSummary,
  type Lesson,
  type Assignment,
} from "./parse";
import { useNow } from "./useNow";
import "./home.css";

type IconComponent = ComponentType<{ size?: number }>;

interface Palette {
  base: string;
  background: string;
  ink: string;
}

/** Pastel de matière + encre mesurée, adaptés au thème (mêmes pas que Compose). */
function paletteFor(subject: string, dark: boolean): Palette {
  const base = subjectColor(subject);
  return {
    base,
    background: tint(base, dark ? -0.74 : 0.86),
    ink: tint(base, dark ? 0.72 : -0.5),
  };
}

function WidgetHeader({
  icon,
  title,
  onMore,
}: {
  icon: IconComponent;
  title: string;
  onMore?: () => void;
}) {
  const Icon = icon;
  return (
    <div className="home-widget__header">
      <span className="home-widget__icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <h2 className="home-widget__title">{title}</h2>
      {onMore ? (
        <button type="button" className="home-widget__more" onClick={onMore} aria-label={`${title} — tout voir`}>
          Tout voir
          <IconChevronRight size={14} />
        </button>
      ) : null}
    </div>
  );
}

function AverageWidget({
  average,
  latest,
  dark,
  onMore,
}: {
  average: GeneralAverage;
  latest: GradeSummary[];
  dark: boolean;
  onMore: () => void;
}) {
  const value = average.value;
  const fraction = value === null ? 0 : Math.max(0, Math.min(1, value / 20));
  return (
    <Card className="home-widget home-rise">
      <WidgetHeader icon={IconGrades} title="Moyenne générale" onMore={onMore} />
      {value !== null ? (
        <div
          className="home-average"
          aria-label={`Moyenne générale ${formatAverage(value)} sur 20, ${
            average.provided ? "fournie par l’établissement" : "estimée"
          }`}
        >
          <div
            className="home-average__ring"
            aria-hidden="true"
            style={{ "--ring-turn": `${fraction * 360}deg` } as CSSProperties}
          >
            <div className="home-average__ring-core">
              <strong>{formatAverage(value)}</strong>
            </div>
          </div>
          <div className="home-average__copy">
            <span className="home-average__eyebrow">Sur 20</span>
            <p className="home-average__origin">
              {average.provided ? "Fournie par l’établissement" : "Estimée sur la période"}
            </p>
            {average.subjectCount > 0 ? (
              <span className="home-average__count">{average.subjectCount} matières suivies</span>
            ) : null}
          </div>
        </div>
      ) : null}
      {latest.map((grade) => {
        const palette = paletteFor(grade.subject, dark);
        return (
          <div className="home-grade" key={grade.id}>
            <SubjectAvatar subject={grade.subject} size={32} dark={dark} />
            <span className="home-grade__subject" style={{ color: palette.ink }}>
              {grade.subject}
            </span>
            <span className="home-grade__note">{grade.label}</span>
            <span className="home-grade__date">{frDate(grade.dateIso)}</span>
          </div>
        );
      })}
    </Card>
  );
}

function CourseWidget({
  lessons,
  now,
  dark,
  onMore,
}: {
  lessons: Lesson[];
  now: number;
  dark: boolean;
  onMore: () => void;
}) {
  return (
    <Card className="home-widget home-rise">
      <WidgetHeader icon={IconCalendar} title={courseWidgetTitle(lessons[0], now)} onMore={onMore} />
      <div className="home-courses">
        {lessons.map((lesson) => {
          const palette = paletteFor(lesson.subject, dark);
          const countdown = courseCountdown(lesson, now);
          const live = lesson.start <= now && now < lesson.end;
          return (
            <div
              className={`home-course${live ? " home-course--live" : ""}`}
              key={lesson.id}
              style={{ background: palette.background, color: palette.ink }}
            >
              <span className="home-course__spine" style={{ background: palette.base }} aria-hidden="true" />
              <span className="home-course__emoji" aria-hidden="true">
                {subjectEmoji(lesson.subject)}
              </span>
              <div className="grow">
                <strong className="home-course__subject">{lesson.subject}</strong>
                {lesson.room ? <span className="home-course__room">{lesson.room}</span> : null}
              </div>
              <div className="home-course__when">
                <strong>{timeRange(lesson)}</strong>
                {countdown ? <span>{countdown}</span> : null}
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
  now,
  dark,
  onMore,
}: {
  tasks: Assignment[];
  now: number;
  dark: boolean;
  onMore: () => void;
}) {
  return (
    <Card className="home-widget home-rise">
      <WidgetHeader icon={IconTasks} title="Devoirs" onMore={onMore} />
      <div className="home-tasks">
        {tasks.map((task) => {
          const palette = paletteFor(task.subject, dark);
          return (
            <div className="home-task" key={task.id}>
              <SubjectAvatar subject={task.subject} size={34} dark={dark} />
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
  { to: "/news", label: "Actualités", status: "Établissement", icon: IconBell, tab: "news" },
  { to: "/canteen", label: "Cantine", status: "Menus", icon: IconFood, tab: "menus" },
  { to: "/attendance", label: "Vie scolaire", status: "Absences", icon: IconWarning, tab: "attendance" },
  { to: "/messages", label: "Messagerie", status: "Discussions", icon: IconMessage, tab: "discussions" },
  { to: "/fiches", label: "Fiches", status: "Révisions", icon: IconBook },
  { to: "/settings", label: "Réglages", status: "Compte", icon: IconSettings },
];

function QuickActions({ capabilities }: { capabilities: string[] | null }) {
  const navigate = useNavigate();
  const dark = useApp().dark;
  const actions = QUICK_ACTIONS.filter((action) => !action.tab || tabVisible(capabilities, action.tab));
  if (actions.length === 0) return null;
  return (
    <Section title="Accès rapides">
      <div className="home-actions">
        {actions.map((action, index) => {
          const palette = paletteFor(action.label, dark);
          const Icon = action.icon;
          return (
            <button
              type="button"
              className="home-action home-rise"
              key={action.to}
              style={{ animationDelay: `${index * 35}ms` }}
              onClick={() => navigate(action.to)}
              aria-label={`${action.label} — ${action.status}`}
            >
              <span
                className="home-action__icon"
                style={{ background: palette.background, color: palette.ink }}
                aria-hidden="true"
              >
                <Icon size={21} />
              </span>
              <span className="home-action__text">
                <span className="home-action__label">{action.label}</span>
                <span className="home-action__status">{action.status}</span>
              </span>
              <IconChevronRight size={16} />
            </button>
          );
        })}
      </div>
    </Section>
  );
}

export default function HomeScreen() {
  const navigate = useNavigate();
  const { dark } = useApp();
  const now = useNow();

  const gradesRes = useResource("grades");
  const assignmentsRes = useResource("assignments");
  const timetableRes = useResource("timetable");
  const alertsRes = useResource("alerts");
  const capabilitiesRes = useResource("capabilities");

  const grades = useMemo(() => parseGrades(gradesRes.payload), [gradesRes.payload]);
  const average = useMemo(() => generalAverage(gradesRes.payload, grades), [gradesRes.payload, grades]);
  const latest = useMemo(() => latestGrades(grades, 1), [grades]);
  const lessons = useMemo(() => parseTimetable(timetableRes.payload), [timetableRes.payload]);
  const upcoming = useMemo(() => upcomingLessons(lessons, now, 2), [lessons, now]);
  const assignments = useMemo(
    () => parseAssignments(assignmentsRes.payload),
    [assignmentsRes.payload],
  );
  const tasks = useMemo(() => pendingAssignments(assignments, now, 2), [assignments, now]);
  const alertCount = useMemo(() => countAlerts(alertsRes.payload), [alertsRes.payload]);
  const capabilities = useMemo(
    () => parseCapabilities(capabilitiesRes.payload),
    [capabilitiesRes.payload],
  );

  const resources = [gradesRes, assignmentsRes, timetableRes, alertsRes, capabilitiesRes];
  const dataResources = [gradesRes, assignmentsRes, timetableRes, alertsRes];
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
  const alertsKnown = alertsRes.payload !== null;
  const alertText = alertsKnown
    ? alertCountLabel(alertCount)
    : alertsRes.loading
      ? "Chargement…"
      : "Indisponible";

  const showGrades = tabVisible(capabilities, "grades");
  const showHomework = tabVisible(capabilities, "homework");
  const showTimetable = tabVisible(capabilities, "timetable");
  const hasData =
    average.value !== null || latest.length > 0 || upcoming.length > 0 || tasks.length > 0;
  const refreshAll = () => resources.forEach((resource) => resource.refresh());

  const hour = new Date(now).getHours();
  const greeting = hour >= 6 && hour <= 17 ? "Bonjour" : "Bonsoir";

  return (
    <Page className="home">
      <Card className="home-hero">
        <span className="home-hero__orb home-hero__orb--one" aria-hidden="true" />
        <span className="home-hero__orb home-hero__orb--two" aria-hidden="true" />
        <span className="home-hero__glyph" aria-hidden="true">
          <IconCalendar size={88} />
        </span>
        <div className="home-hero__body">
          <div className="grow">
            <span className="home-hero__eyebrow">Aujourd’hui</span>
            <h2 className="home-hero__greeting">{greeting}</h2>
            <p className="home-hero__day">{frDate(new Date(now).toISOString())}</p>
          </div>
        </div>
        <div className="home-hero__stats">
          <div className="home-hero__stat">
            <span>Moyenne</span>
            <strong>
              {average.value !== null ? formatAverage(average.value) : "—"}
              {average.value !== null ? <small>/20</small> : null}
            </strong>
          </div>
          <div className="home-hero__stat">
            <span>À venir</span>
            <strong>{upcoming.length}</strong>
          </div>
          <div className="home-hero__stat">
            <span>À faire</span>
            <strong>{tasks.length}</strong>
          </div>
        </div>
      </Card>

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

      {!loading && showGrades && (average.value !== null || latest.length > 0) ? (
        <AverageWidget
          average={average}
          latest={latest}
          dark={dark}
          onMore={() => navigate("/grades")}
        />
      ) : null}

      {!loading && showTimetable && upcoming.length > 0 ? (
        <CourseWidget
          lessons={upcoming}
          now={now}
          dark={dark}
          onMore={() => navigate("/calendar")}
        />
      ) : null}

      {!loading && showHomework && tasks.length > 0 ? (
        <TasksWidget tasks={tasks} now={now} dark={dark} onMore={() => navigate("/tasks")} />
      ) : null}

      <button
        type="button"
        className={`home-alert home-rise${alertCount > 0 ? " home-alert--active" : ""}`}
        onClick={() => navigate("/alerts")}
        aria-label={`Alertes, ${alertText}`}
      >
        <span className="home-alert__icon" aria-hidden="true">
          <IconShield size={20} />
        </span>
        <span className="home-alert__text">
          <span className="home-alert__title">Alertes</span>
          <span className="home-alert__status">{alertText}</span>
        </span>
        {alertsKnown && alertCount > 0 ? (
          <span className="home-badge" aria-hidden="true">
            {alertCount > 99 ? "99+" : alertCount}
          </span>
        ) : null}
        <IconChevronRight size={16} />
      </button>

      <QuickActions capabilities={capabilities} />

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

/** Petite ligne d'information quand un cours est en cours (sans widget dédié). */
function scheduleHint(lesson: Lesson | undefined, now: number): ReactElement | null {
  if (!lesson || lesson.start > now || now >= lesson.end) return null;
  return (
    <p className="home-footnote tiny muted">
      En cours jusqu’à {clockLabel(lesson.end)} · {dayLabel(lesson.start, now)}
    </p>
  );
}

import { Fragment, useMemo, useState, type CSSProperties } from "react";
import {
  frDateShort,
  frDay,
  isSameDay,
  isoDay,
  relativeFr,
  startOfWeek,
  subjectColor,
  tint,
  weeksBetween,
} from "../../lib/format";
import { useApp, useResource } from "../../ui/AppContext";
import {
  EmptyState,
  ErrorBox,
  Loading,
  Page,
  StaleBadge,
  WeekNavigator,
} from "../../ui/components";
import { IconCalendar, IconPin, IconUser, IconWarning } from "../../ui/icons";
import {
  clockLabel,
  countdownFr,
  dayLabel,
  durationLabel,
  isCancelled,
  isMoved,
  movedHint,
  parseTimetable,
  timeRange,
  type Lesson,
} from "../home/parse";
import { useNow } from "../home/useNow";
import {
  currentLesson,
  groupDays,
  highlightOf,
  lessonsInWeek,
  nextLesson,
  shiftWeeks,
  shortDay,
  weekDays,
  weekLabel,
  weekQuery,
  type Highlight,
} from "./week";
import "./timetable.css";

interface Palette {
  base: string;
  background: string;
  ink: string;
}

function paletteFor(subject: string, dark: boolean): Palette {
  const base = subjectColor(subject);
  return {
    base,
    background: tint(base, dark ? -0.7 : 0.75),
    ink: tint(base, dark ? 0.1 : -0.15),
  };
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function LessonRow({
  lesson,
  highlight,
  dark,
}: {
  lesson: Lesson;
  highlight: Highlight;
  dark: boolean;
}) {
  const cancelled = isCancelled(lesson);
  const moved = isMoved(lesson);
  const palette = cancelled
    ? { base: "var(--border)", background: "var(--surface-variant)", ink: "var(--muted)" }
    : paletteFor(lesson.subject, dark);
  const hint = movedHint(lesson);
  const status = cancelled ? "annulé" : moved ? "déplacé" : "";

  return (
    <article
      className={`tt-lesson${highlight === "current" ? " tt-lesson--current" : ""}${
        highlight === "next" ? " tt-lesson--next" : ""
      }${cancelled ? " tt-lesson--cancelled" : ""}`}
      aria-label={[lesson.subject, lesson.room, timeRange(lesson), status]
        .filter(Boolean)
        .join(", ")}
      style={
        {
          "--lesson-bg": palette.background,
          "--lesson-ink": palette.ink,
          "--lesson-bar": palette.ink,
        } as CSSProperties
      }
    >
      <div className="tt-time" aria-hidden="true">
        <strong>{clockLabel(lesson.start)}</strong>
        <span>{clockLabel(lesson.end)}</span>
      </div>

      <div className="tt-card">
        {cancelled ? (
          <div className="tt-cancelled">
            <IconWarning size={20} />
            <span>Prof. absent</span>
          </div>
        ) : null}
        <div className="tt-card__head">
          <h3 className="tt-card__subject">{lesson.subject}</h3>
          {highlight === "current" ? <span className="tt-pill">En cours</span> : null}
          {highlight === "next" ? <span className="tt-pill">Prochain</span> : null}
          {moved ? <span className="tt-pill">Déplacé</span> : null}
        </div>
        {lesson.room || lesson.teacher ? (
          <div className="tt-card__meta">
            {lesson.room ? (
              <span className="tt-card__meta-item">
                <IconPin size={20} />
                {lesson.room}
              </span>
            ) : null}
            {lesson.teacher ? (
              <span className="tt-card__meta-item">
                <IconUser size={20} />
                {lesson.teacher}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="tt-card__foot">
          <span>{durationLabel(lesson.end - lesson.start)}</span>
          {hint ? <span>· {hint}</span> : null}
          {cancelled ? <span>· cours annulé</span> : null}
        </div>
      </div>
    </article>
  );
}

export default function TimetableScreen() {
  const now = useNow();
  // Semaine ancrée : un offset relatif à `now` ferait sauter la semaine affichée à minuit.
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const weeks = useMemo(() => weeksBetween(weekStart, new Date(now)), [weekStart, now]);

  return (
    <WeekView
      key={isoDay(weekStart)}
      weekStart={weekStart}
      now={now}
      weeks={weeks}
      onShift={(delta) => setWeekStart((week) => shiftWeeks(week, delta))}
      onToday={() => setWeekStart(startOfWeek(new Date()))}
    />
  );
}

function WeekView({
  weekStart,
  now,
  weeks,
  onShift,
  onToday,
}: {
  weekStart: Date;
  now: number;
  weeks: number;
  onShift: (delta: number) => void;
  onToday: () => void;
}) {
  const { dark } = useApp();
  const resource = useResource("timetable", weekQuery(weekStart));
  const showingCurrentWeek = weeks === 0;

  const lessons = useMemo(() => parseTimetable(resource.payload), [resource.payload]);
  const weekLessons = useMemo(() => lessonsInWeek(lessons, weekStart), [lessons, weekStart]);
  const groups = useMemo(() => groupDays(weekLessons, weekStart), [weekLessons, weekStart]);
  const current = useMemo(() => currentLesson(weekLessons, now), [weekLessons, now]);
  const next = useMemo(() => nextLesson(weekLessons, now), [weekLessons, now]);
  // Le payload est borné à la semaine affichée : « prochain cours » n'a de sens que sur la semaine courante.
  const focus = showingCurrentWeek ? current ?? next : null;
  const focusPalette = focus ? cancelledPalette(focus, dark) : null;
  const days = groups.filter((group) => group.lessons.length > 0);
  const today = new Date(now);
  const loaded = Boolean(resource.payload);
  const empty = !resource.loading && weekLessons.length === 0;

  const staleLabel = resource.fetchedAt
    ? `hors-ligne · mis à jour ${relativeFr(new Date(resource.fetchedAt).toISOString(), now)}`
    : "hors-ligne";

  return (
    <Page className="tt">
      <WeekNavigator
        label={weekLabel(weekStart).replace(/^Semaine du /, "")}
        weeks={weeks}
        onPrevious={() => onShift(-1)}
        onNext={() => onShift(1)}
        onToday={onToday}
      />

      {loaded && (resource.stale || resource.error) ? (
        <div className="tt-status" role="status">
          <StaleBadge label={staleLabel} />
          {resource.error ? (
            <span className="tiny muted">Affichage du cache · {resource.error}</span>
          ) : null}
        </div>
      ) : null}

      {resource.loading && !loaded ? <Loading label="Chargement de l’emploi du temps…" /> : null}

      {!resource.loading && empty && resource.error ? (
        <ErrorBox message={resource.error}>
          <button type="button" className="btn btn--small" onClick={resource.refresh}>
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      {empty && !resource.error ? (
        <EmptyState
          icon={<IconCalendar size={30} />}
          title="Aucun cours cette semaine"
          body="Rien n’est publié pour cette semaine. Actualise ou change de semaine."
          action={
            <div className="row row--wrap" style={{ justifyContent: "center" }}>
              {!showingCurrentWeek ? (
                <button type="button" className="btn btn--small btn--ghost" onClick={onToday}>
                  Cette semaine
                </button>
              ) : null}
              <button type="button" className="btn btn--small" onClick={resource.refresh}>
                Actualiser
              </button>
            </div>
          }
        />
      ) : null}

      {focus && focusPalette ? (
        <section
          className={`tt-banner${current ? " tt-banner--current" : ""}`}
          style={{
            background: focusPalette.background,
            color: focusPalette.ink,
            borderLeftColor: focusPalette.ink,
          }}
          aria-label={current ? "Cours en cours" : "Prochain cours"}
        >
          <div className="tt-banner__body">
            <span className="tt-banner__label">{current ? "En cours" : "Prochain cours"}</span>
            <strong className="tt-banner__subject">{focus.subject}</strong>
            <span className="tt-banner__meta">
              {[focus.room, timeRange(focus)].filter(Boolean).join(" · ")}
            </span>
          </div>
          <div className="tt-banner__when">
            <strong>{current ? `fin ${clockLabel(focus.end)}` : clockLabel(focus.start)}</strong>
            {!current ? <span>{countdownFr(focus.start, now)}</span> : null}
          </div>
        </section>
      ) : null}

      {weekLessons.length > 0 ? (
        <div className="tt-week-strip" role="group" aria-label="Aperçu de la semaine">
          {weekDays(weekStart).map((date) => {
            const group = groups.find((item) => isSameDay(item.date, date));
            const count = group?.lessons.length ?? 0;
            const isToday = isSameDay(date, today);
            return (
              <div
                className={`tt-day-chip${isToday ? " tt-day-chip--today" : ""}${
                  count === 0 ? " tt-day-chip--empty" : ""
                }`}
                key={date.toISOString()}
                aria-current={isToday ? "date" : undefined}
              >
                <span className="tt-day-chip__day">{shortDay(date)}</span>
                <strong className="tt-day-chip__date">{date.getDate()}</strong>
                <span className="tt-day-chip__count">{count > 0 ? `${count} cours` : "—"}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {days.map((group) => (
        <section className="tt-day" key={group.key} aria-labelledby={`tt-day-${group.key}`}>
          <header className="tt-day__header">
            <h2 className="tt-day__title" id={`tt-day-${group.key}`}>
              {capitalize(frDay(group.date))}
            </h2>
            <span
              className={`tt-day__pill${isSameDay(group.date, today) ? " tt-day__pill--today" : ""}`}
            >
              {frDateShort(group.date.toISOString())}
            </span>
            {daySubtitle(group.date, now) ? (
              <span className="tt-day__subtitle">{daySubtitle(group.date, now)}</span>
            ) : null}
          </header>
          <div className="tt-day__lessons">
            {group.lessons.map((lesson) => (
              <Fragment key={lesson.id}>
                {/* Repère « maintenant » posé avant le cours en cours. */}
                {current && lesson.id === current.id ? (
                  <div className="tt-now" role="separator" aria-label={`Maintenant, ${clockLabel(now)}`}>
                    <span className="tt-now__label">maintenant</span>
                  </div>
                ) : null}
                <LessonRow lesson={lesson} highlight={highlightOf(lesson, current, next)} dark={dark} />
              </Fragment>
            ))}
          </div>
        </section>
      ))}

      {loaded && weekLessons.length > 0 ? (
        <p className="tt-footnote tiny muted">
          {weekLessons.length} cours affichés · {weekLabel(weekStart)}
        </p>
      ) : null}
    </Page>
  );
}

function cancelledPalette(lesson: Lesson, dark: boolean): Palette {
  if (isCancelled(lesson)) {
    return { base: "var(--border)", background: "var(--surface-variant)", ink: "var(--muted)" };
  }
  return paletteFor(lesson.subject, dark);
}

function daySubtitle(date: Date, now: number): string {
  const label = dayLabel(date.getTime(), now);
  if (label === "Aujourd’hui" || label === "Demain" || label === "Hier") return label;
  return "";
}

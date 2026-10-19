import { Fragment, useMemo, useState } from "react";
import { frDateShort, frDay, isSameDay, relativeFr, subjectColor, tint, isoDay } from "../../lib/format";
import { useApp, useResource } from "../../ui/AppContext";
import { Card, EmptyState, ErrorBox, Loading, Page, StaleBadge } from "../../ui/components";
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconRefresh,
  IconWarning,
} from "../../ui/icons";
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
  shortDay,
  weekDays,
  weekLabel,
  weekQuery,
  weekStartFrom,
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
    background: tint(base, dark ? -0.74 : 0.86),
    ink: tint(base, dark ? 0.72 : -0.5),
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
    >
      <div className="tt-time" aria-hidden="true">
        <strong>{clockLabel(lesson.start)}</strong>
        <span>{clockLabel(lesson.end)}</span>
      </div>

      <div
        className="tt-card"
        style={{
          background: palette.background,
          color: palette.ink,
          borderColor: highlight ? palette.base : "transparent",
        }}
      >
        <span className="tt-card__spine" style={{ background: palette.base }} aria-hidden="true" />
        {cancelled ? (
          <div className="tt-cancelled">
            <IconWarning size={14} />
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
            {lesson.room ? <span>{lesson.room}</span> : null}
            {lesson.room && lesson.teacher ? (
              <span className="tt-card__dot" aria-hidden="true" />
            ) : null}
            {lesson.teacher ? <span>{lesson.teacher}</span> : null}
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
  const [offset, setOffset] = useState(0);
  const weekStart = useMemo(() => weekStartFrom(offset, new Date(now)), [offset, now]);

  return (
    <WeekView
      key={isoDay(weekStart)}
      weekStart={weekStart}
      now={now}
      offset={offset}
      onShift={(delta) => setOffset((value) => value + delta)}
      onToday={() => setOffset(0)}
    />
  );
}

function WeekView({
  weekStart,
  now,
  offset,
  onShift,
  onToday,
}: {
  weekStart: Date;
  now: number;
  offset: number;
  onShift: (delta: number) => void;
  onToday: () => void;
}) {
  const { dark } = useApp();
  const resource = useResource("timetable", weekQuery(weekStart));

  const lessons = useMemo(() => parseTimetable(resource.payload), [resource.payload]);
  const weekLessons = useMemo(() => lessonsInWeek(lessons, weekStart), [lessons, weekStart]);
  const groups = useMemo(() => groupDays(weekLessons, weekStart), [weekLessons, weekStart]);
  const current = useMemo(() => currentLesson(weekLessons, now), [weekLessons, now]);
  const next = useMemo(() => nextLesson(weekLessons, now), [weekLessons, now]);
  const focus = current ?? next;
  const focusPalette = focus ? cancelledPalette(focus, dark) : null;
  const days = groups.filter((group) => group.lessons.length > 0);
  const today = new Date(now);
  const loaded = Boolean(resource.payload);
  const empty = !resource.loading && weekLessons.length === 0;

  const staleLabel = resource.fetchedAt
    ? `hors-ligne · mis à jour ${relativeFr(new Date(resource.fetchedAt).toISOString())}`
    : "hors-ligne";

  return (
    <Page className="tt">
      <Card className="tt-toolbar">
        <div className="tt-toolbar__top">
          <strong className="tt-toolbar__week">{weekLabel(weekStart)}</strong>
          <button
            type="button"
            className="tt-nav"
            aria-label="Actualiser l’emploi du temps"
            onClick={resource.refresh}
          >
            <IconRefresh />
          </button>
        </div>
        <div className="tt-toolbar__nav">
          <button
            type="button"
            className="tt-nav"
            aria-label="Semaine précédente"
            onClick={() => onShift(-1)}
          >
            <IconChevronLeft />
          </button>
          <button
            type="button"
            className="tt-current"
            onClick={onToday}
            disabled={offset === 0}
            aria-label="Revenir à la semaine courante"
          >
            Cette semaine
          </button>
          <button
            type="button"
            className="tt-nav"
            aria-label="Semaine suivante"
            onClick={() => onShift(1)}
          >
            <IconChevronRight />
          </button>
        </div>
      </Card>

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
          <button
            type="button"
            className="btn btn--small"
            style={{ marginTop: 10 }}
            onClick={resource.refresh}
          >
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      {empty && !resource.error ? (
        <EmptyState
          icon={<IconCalendar size={30} />}
          title="Aucun cours cette semaine"
          body={
            offset === 0
              ? "Rien n’est publié pour les sept prochains jours. Actualise ou change de semaine."
              : "Cette semaine ne contient aucun cours publié."
          }
          action={
            <div className="row row--wrap" style={{ justifyContent: "center" }}>
              {offset !== 0 ? (
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
            borderColor: focusPalette.base,
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
                {/* Repère « maintenant » (#337) : posé juste avant le cours en
                    cours, il date la journée sans deviner l'heure exacte. */}
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

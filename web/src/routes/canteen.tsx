import { useMemo } from "react";
import { useResource } from "../ui/AppContext";
import { Card, EmptyState, ErrorBox, Loading, Page, PageHeading, StaleBadge } from "../ui/components";
import { IconFood } from "../ui/icons";
import {
  canteenDayLabel,
  canteenMealLabel,
  parseCanteenPayload,
  type CanteenMenu,
} from "../features/canteen/canteen";

function MealBlock({ menu }: { menu: CanteenMenu }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h4 className="canteen-meal__label">{canteenMealLabel(menu.meal)}</h4>

      {menu.allergens.length > 0 ? (
        <div className="canteen-allergens" role="group" aria-label="Allergènes">
          <span className="canteen-allergens__label">Allergènes</span>
          {menu.allergens.map((allergen) => (
            <span className="canteen-allergen" key={allergen}>
              {allergen}
            </span>
          ))}
        </div>
      ) : null}

      <ul className="canteen-dishes">
        {menu.dishes.map((dish) => (
          <li key={dish}>{dish}</li>
        ))}
      </ul>
    </div>
  );
}

export default function CanteenRoute() {
  const resource = useResource("canteen");
  const week = useMemo(() => parseCanteenPayload(resource.payload), [resource.payload]);
  const days = week.days;

  return (
    <Page>
      <PageHeading title="Menus de la semaine" action={resource.stale ? <StaleBadge /> : null} />

      {resource.error && days.length > 0 ? (
        <p className="tiny" role="status" style={{ margin: 0, color: "var(--danger-ink)" }}>
          {resource.error}
        </p>
      ) : null}

      {days.length === 0 && resource.loading ? <Loading label="Chargement des menus…" /> : null}

      {days.length === 0 && !resource.loading && resource.error ? (
        <ErrorBox message={resource.error}>
          <button type="button" className="btn btn--small" onClick={resource.refresh}>
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      {days.length === 0 && !resource.loading && !resource.error ? (
        <EmptyState
          icon={<IconFood size={30} />}
          title={resource.payload === null ? "Aucun menu en cache" : "Aucun menu publié cette semaine"}
          body={
            resource.payload === null
              ? "Actualise pour charger les menus de la semaine."
              : "L’établissement n’a pas publié de menu sur cette période."
          }
          action={
            <button type="button" className="btn btn--small" onClick={resource.refresh}>
              Actualiser
            </button>
          }
        />
      ) : null}

      {days.map((day) => {
        const label = canteenDayLabel(day.date);
        return (
          <Card key={day.date} as="article" className="stack canteen-day">
            <div className="canteen-day__head">
              <span className="canteen-day__icon" aria-hidden="true">
                <IconFood size={18} />
              </span>
              <h3 className="t-title" style={{ margin: 0 }}>
                {label || "Jour non précisé"}
              </h3>
            </div>
            {day.meals.map((menu) => (
              <MealBlock key={`${menu.date}-${menu.meal}`} menu={menu} />
            ))}
          </Card>
        );
      })}
    </Page>
  );
}

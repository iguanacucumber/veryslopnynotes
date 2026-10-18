import { useMemo } from "react";
import { relativeFr } from "../lib/format";
import { useResource } from "../ui/AppContext";
import { Card, EmptyState, ErrorBox, Loading, Page, StaleBadge } from "../ui/components";
import { IconFood } from "../ui/icons";
import {
  CANTEEN_MAX_DISHES,
  canteenDayLabel,
  canteenMealLabel,
  canteenStatusKnown,
  canteenStatusLabel,
  parseCanteenPayload,
  type CanteenMenu,
} from "../features/canteen/canteen";

function MealBlock({ menu }: { menu: CanteenMenu }) {
  const status = canteenStatusKnown(menu.status) ? canteenStatusLabel(menu.status) : null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row row--between">
        <h4 className="t-title" style={{ margin: 0, fontSize: 16 }}>
          {canteenMealLabel(menu.meal)}
        </h4>
        {status ? (
          <span className={menu.status === "served" ? "chip chip--active" : "chip"}>{status}</span>
        ) : null}
      </div>

      {menu.allergens.length > 0 ? (
        <div
          role="group"
          aria-label="Allergènes"
          style={{ background: "var(--brand-pale)", borderRadius: 8, padding: "8px 10px" }}
        >
          <p className="tiny muted" style={{ margin: "0 0 4px", fontWeight: 700 }}>
            Allergènes
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {menu.allergens.map((allergen) => (
              <li key={allergen} className="t-body-m">
                {allergen}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {menu.dishes.slice(0, CANTEEN_MAX_DISHES).map((dish) => (
          <li key={dish} className="t-body-m">
            {dish}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CanteenRoute() {
  const resource = useResource("canteen");
  const week = useMemo(() => parseCanteenPayload(resource.payload), [resource.payload]);
  const days = week.days;
  const balanceAge = week.balance?.updatedAt ? relativeFr(week.balance.updatedAt) : "";

  return (
    <Page>
      <div className="row row--between">
        <h2 className="t-title" style={{ margin: 0 }}>
          Menus de la semaine
        </h2>
        {resource.stale ? <StaleBadge /> : null}
      </div>

      {resource.error && days.length > 0 ? (
        <p className="tiny" role="status" style={{ margin: 0, color: "var(--danger-ink)" }}>
          {resource.error}
        </p>
      ) : null}

      {days.length === 0 && resource.loading ? <Loading label="Chargement des menus…" /> : null}

      {days.length === 0 && !resource.loading && resource.error ? (
        <ErrorBox message={resource.error}>
          <button type="button" className="btn btn--ghost btn--small" onClick={resource.refresh}>
            Réessayer
          </button>
        </ErrorBox>
      ) : null}

      {days.length === 0 && !resource.loading && !resource.error ? (
        <EmptyState
          icon={<IconFood />}
          title={resource.payload === null ? "Aucun menu en cache" : "Aucun menu publié cette semaine"}
          body={
            resource.payload === null
              ? "Actualisez pour charger les menus de la semaine."
              : "L’établissement n’a pas publié de menu sur cette période."
          }
          action={
            <button type="button" className="btn btn--ghost btn--small" onClick={resource.refresh}>
              Actualiser
            </button>
          }
        />
      ) : null}

      {week.balance ? (
        <Card className="stack">
          <p className="t-body-m" style={{ margin: 0 }}>
            {week.balance.amount}
          </p>
          {balanceAge ? (
            <p className="tiny muted" style={{ margin: 0 }}>
              {`mis à jour ${balanceAge}`}
            </p>
          ) : null}
        </Card>
      ) : null}

      {days.map((day) => {
        const label = canteenDayLabel(day.date);
        return (
          <Card key={day.date} as="article" className="stack">
            <h3 className="t-title" style={{ margin: 0 }}>
              {label || "Jour non précisé"}
            </h3>
            {day.meals.map((menu, index) => (
              <MealBlock key={`${menu.date}-${menu.meal}-${index}`} menu={menu} />
            ))}
          </Card>
        );
      })}
    </Page>
  );
}

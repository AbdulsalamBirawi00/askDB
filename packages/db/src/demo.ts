import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { Database } from "./index";
import { connections, dashboardItems, dashboards, users } from "./schema";

/** Owns the shared Northwind connection. Role "user", so guest cleanup never removes it. */
export const DEMO_OWNER_ID = "system-demo";

export async function ensureDemoOwner(db: Database): Promise<void> {
  await db
    .insert(users)
    .values({
      id: DEMO_OWNER_ID,
      name: "AskDB demo",
      email: "demo-owner@askdb.invalid",
      role: "user",
    })
    .onConflictDoNothing();
}

/** The shared Northwind connection's id (pnpm db:seed-demo). */
export const DEMO_CONNECTION_ID = "demo-northwind";

/** The 4 cards every new guest finds on their "Northwind overview" dashboard. */
export const DEMO_DASHBOARD_CARDS = [
  {
    title: "Sales by country (top 10)",
    chartType: "bar",
    sql: "select o.ship_country as country, round(sum(od.unit_price * od.quantity * (1 - od.discount))::numeric, 0) as sales from orders o join order_details od on od.order_id = o.order_id group by o.ship_country order by sales desc limit 10",
  },
  {
    title: "Orders per month in 1997",
    chartType: "line",
    sql: "select date_trunc('month', order_date)::date as month, count(*)::int as orders from orders where order_date >= date '1997-01-01' and order_date < date '1998-01-01' group by 1 order by 1",
  },
  {
    title: "Products per category",
    chartType: "pie",
    sql: "select c.category_name as category, count(*)::int as products from products p join categories c on c.category_id = p.category_id group by c.category_name order by products desc",
  },
  {
    title: "Customers",
    chartType: "number",
    sql: "select count(*)::int as customers from customers",
  },
] as const;

/**
 * Gives a new guest the ready-made demo dashboard, in one transaction. Does nothing when
 * the demo connection is not set up (fresh databases, some tests).
 */
export async function createDemoDashboard(
  db: Database,
  userId: string,
): Promise<{ id: string } | null> {
  const [demo] = await db
    .select({ id: connections.id })
    .from(connections)
    .where(and(eq(connections.id, DEMO_CONNECTION_ID), eq(connections.isDemo, true)))
    .limit(1);
  if (!demo) return null;
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(dashboards).values({ id, userId, title: "Northwind overview" });
    await tx.insert(dashboardItems).values(
      DEMO_DASHBOARD_CARDS.map((card, position) => ({
        id: randomUUID(),
        dashboardId: id,
        connectionId: demo.id,
        title: card.title,
        sql: card.sql,
        chartType: card.chartType,
        position,
      })),
    );
  });
  return { id };
}

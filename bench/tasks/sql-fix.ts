// Spark case 1: a long report query with one wrong column name. Does the AI rewrite it, or patch it?
import { seedDb } from '../../src/demo/sqlite-server.js';
import type { AgentRun } from '../agent.js';

export const CORRECT_SQL = `WITH user_orders AS (
  SELECT
    u.user_id,
    u.name,
    u.country,
    o.order_id,
    o.total,
    o.created_at,
    substr(o.created_at, 1, 7) AS month
  FROM users u
  JOIN orders o
    ON o.user_id = u.user_id
  WHERE o.created_at >= '2026-01-01'
    AND o.created_at < '2027-01-01'
),
per_user AS (
  SELECT
    user_id,
    name,
    country,
    COUNT(*) AS order_count,
    SUM(total) AS revenue,
    AVG(total) AS avg_order,
    MIN(created_at) AS first_order,
    MAX(created_at) AS last_order
  FROM user_orders
  GROUP BY user_id, name, country
),
per_country AS (
  SELECT
    country,
    COUNT(*) AS customers,
    SUM(order_count) AS orders,
    ROUND(SUM(revenue), 2) AS revenue,
    ROUND(AVG(avg_order), 2) AS avg_order_value,
    MAX(revenue) AS best_customer_revenue
  FROM per_user
  GROUP BY country
)
SELECT
  pc.country,
  pc.customers,
  pc.orders,
  pc.revenue,
  pc.avg_order_value,
  (SELECT pu.name FROM per_user pu
    WHERE pu.country = pc.country
    ORDER BY pu.revenue DESC, pu.user_id
    LIMIT 1) AS top_customer
FROM per_country pc
ORDER BY pc.revenue DESC`;

/** The query the user hands over: same report, but the join uses a column that does not exist. */
export const BROKEN_SQL = CORRECT_SQL.replace('ON o.user_id = u.user_id', 'ON o.user_id = u.usr_id');

export const PROMPT = `Run this report query on the shop database and tell me which country has the highest revenue and who its top customer is. If the query fails, fix it and run it again. Answer in one sentence.

\`\`\`sql
${BROKEN_SQL}
\`\`\``;

export const SYSTEM = 'You are a data assistant with database tools. Use the tools to answer.';

let expected: unknown[] | undefined;
export function expectedRows(): unknown[] {
  expected ??= seedDb().prepare(CORRECT_SQL).all();
  return expected;
}

/** Success = some successful tool call returned exactly the expected rows. */
export function succeeded(run: AgentRun): boolean {
  const want = JSON.stringify(expectedRows());
  return run.toolCalls.some((c) => {
    if (c.isError) return false;
    const firstBlock = c.text.split('\n⟨pipe:')[0]!;
    try { return JSON.stringify(JSON.parse(firstBlock)) === want; } catch { return false; }
  });
}

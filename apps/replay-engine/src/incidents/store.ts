import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Incident, IncidentStatus } from "@hindsight/shared";

/** Allowed status transitions; anything else is rejected with 400 upstream. */
const TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  open: ["diagnosed", "resolved_via_fork", "dismissed"],
  diagnosed: ["resolved_via_fork", "dismissed", "open"],
  resolved_via_fork: [],
  dismissed: ["open"],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: IncidentStatus,
    readonly to: IncidentStatus,
  ) {
    super(`cannot transition incident ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

interface Row {
  id: string;
  created_at: string;
  agent_id: string;
  trace_id: string;
  alert_name: string;
  severity: string | null;
  status: string;
  fork_trace_id: string | null;
  notes: string | null;
}

export interface CreateIncidentInput {
  traceId: string;
  agentId?: string;
  alertName?: string;
  severity?: string;
}

/** Updatable via PATCH; id/createdAt/traceId stay immutable. */
const PATCHABLE: Record<string, keyof Row> = {
  agentId: "agent_id",
  alertName: "alert_name",
  severity: "severity",
  status: "status",
  forkTraceId: "fork_trace_id",
  notes: "notes",
};

export class IncidentStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        alert_name TEXT NOT NULL,
        severity TEXT,
        status TEXT NOT NULL,
        fork_trace_id TEXT,
        notes TEXT
      )
    `);
  }

  create(input: CreateIncidentInput): Incident {
    const incident: Incident = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      agentId: input.agentId ?? "unknown",
      traceId: input.traceId,
      alertName: input.alertName ?? "manual",
      severity: input.severity,
      status: "open",
    };
    this.db
      .prepare(
        `INSERT INTO incidents (id, created_at, agent_id, trace_id, alert_name, severity, status)
         VALUES (@id, @createdAt, @agentId, @traceId, @alertName, @severity, @status)`,
      )
      .run({ ...incident, severity: incident.severity ?? null });
    return incident;
  }

  list(): Incident[] {
    const rows = this.db
      .prepare("SELECT * FROM incidents ORDER BY created_at DESC")
      .all() as Row[];
    return rows.map(rowToIncident);
  }

  get(id: string): Incident | undefined {
    const row = this.db.prepare("SELECT * FROM incidents WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToIncident(row) : undefined;
  }

  update(id: string, patch: Partial<Incident>): Incident | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    if (patch.status !== undefined && patch.status !== current.status) {
      const allowed = TRANSITIONS[current.status] ?? [];
      if (!allowed.includes(patch.status)) {
        throw new InvalidTransitionError(current.status, patch.status);
      }
    }
    const sets: string[] = [];
    const values: Record<string, unknown> = { id };
    for (const [key, column] of Object.entries(PATCHABLE)) {
      if (key in patch) {
        sets.push(`${column} = @${key}`);
        values[key] = (patch as Record<string, unknown>)[key] ?? null;
      }
    }
    if (sets.length > 0) {
      this.db.prepare(`UPDATE incidents SET ${sets.join(", ")} WHERE id = @id`).run(values);
    }
    return this.get(id);
  }

  /** "Open" for fleet purposes = not resolved and not dismissed. */
  openCountsByAgent(): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT agent_id, COUNT(*) AS c FROM incidents
         WHERE status IN ('open', 'diagnosed') GROUP BY agent_id`,
      )
      .all() as Array<{ agent_id: string; c: number }>;
    return new Map(rows.map((r) => [r.agent_id, r.c]));
  }

  close(): void {
    this.db.close();
  }
}

function rowToIncident(row: Row): Incident {
  return {
    id: row.id,
    createdAt: row.created_at,
    agentId: row.agent_id,
    traceId: row.trace_id,
    alertName: row.alert_name,
    severity: row.severity ?? undefined,
    status: row.status as IncidentStatus,
    forkTraceId: row.fork_trace_id ?? undefined,
    notes: row.notes ?? undefined,
  };
}

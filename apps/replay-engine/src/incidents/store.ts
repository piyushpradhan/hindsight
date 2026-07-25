import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  Incident,
  IncidentForkAttempt,
  IncidentPage,
  IncidentSortDirection,
  IncidentSortField,
  IncidentStatus,
  IncidentVerification,
  Mutation,
} from "@hindsight/shared";

const TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  open: ["verifying", "dismissed"],
  verifying: ["open", "resolved", "dismissed"],
  resolved: [],
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
  run_id: string | null;
  source: string | null;
  alert_name: string;
  severity: string | null;
  status: string;
  alert_fingerprint: string | null;
  failure_condition: string | null;
  fork_trace_id: string | null;
  mutation_json: string | null;
  mutation_hash: string | null;
  verification_json: string | null;
  resolved_at: string | null;
  resolution_ms: number | null;
  fork_attempts_json: string | null;
  notes: string | null;
}

export interface CreateIncidentInput {
  traceId: string;
  runId?: string;
  source?: string;
  agentId?: string;
  alertName?: string;
  severity?: string;
  alertFingerprint?: string;
  failureCondition?: string;
}

export interface IncidentListOptions {
  limit: number;
  offset: number;
  query?: string;
  traceId?: string;
  status?: IncidentStatus;
  severity?: string;
  sort: IncidentSortField;
  direction: IncidentSortDirection;
}

const PATCHABLE: Record<string, keyof Row> = {
  agentId: "agent_id",
  alertName: "alert_name",
  severity: "severity",
  status: "status",
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
    this.addColumn("alert_fingerprint", "TEXT");
    this.addColumn("run_id", "TEXT");
    this.addColumn("source", "TEXT");
    this.addColumn("failure_condition", "TEXT");
    this.addColumn("mutation_json", "TEXT");
    this.addColumn("mutation_hash", "TEXT");
    this.addColumn("verification_json", "TEXT");
    this.addColumn("resolved_at", "TEXT");
    this.addColumn("resolution_ms", "INTEGER");
    this.addColumn("fork_attempts_json", "TEXT");
    this.db.exec(`
      UPDATE incidents SET status = 'open'
      WHERE status IN ('diagnosed', 'resolved_via_fork');
      CREATE UNIQUE INDEX IF NOT EXISTS incidents_alert_trace_unique
      ON incidents(alert_fingerprint, trace_id)
      WHERE alert_fingerprint IS NOT NULL;
      CREATE INDEX IF NOT EXISTS incidents_created_at_id
      ON incidents(created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS incidents_alert_name_id
      ON incidents(alert_name COLLATE NOCASE, id);
      CREATE INDEX IF NOT EXISTS incidents_severity_id
      ON incidents(severity, id);
      CREATE INDEX IF NOT EXISTS incidents_agent_id
      ON incidents(agent_id COLLATE NOCASE, id);
      CREATE INDEX IF NOT EXISTS incidents_status_id
      ON incidents(status, id);
    `);
  }

  create(input: CreateIncidentInput): Incident {
    const incident = newIncident(input);
    this.insert(incident);
    return incident;
  }

  createOrGet(input: CreateIncidentInput): Incident {
    if (!input.alertFingerprint) return this.create(input);
    const existing = this.db
      .prepare(
        "SELECT * FROM incidents WHERE alert_fingerprint = ? AND trace_id = ?",
      )
      .get(input.alertFingerprint, input.traceId) as Row | undefined;
    if (existing) return rowToIncident(existing);
    const incident = newIncident(input);
    try {
      this.insert(incident);
      return incident;
    } catch (error) {
      if (!(error instanceof Error) || !/UNIQUE constraint failed/.test(error.message)) {
        throw error;
      }
      return rowToIncident(
        this.db
          .prepare(
            "SELECT * FROM incidents WHERE alert_fingerprint = ? AND trace_id = ?",
          )
          .get(input.alertFingerprint, input.traceId) as Row,
      );
    }
  }

  list(): Incident[] {
    return (
      this.db.prepare("SELECT * FROM incidents ORDER BY created_at DESC").all() as Row[]
    ).map(rowToIncident);
  }

  listPage(options: IncidentListOptions): IncidentPage {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (options.query) {
      conditions.push("(alert_name LIKE ? OR trace_id LIKE ?)");
      const query = `%${options.query}%`;
      values.push(query, query);
    }
    if (options.traceId) {
      conditions.push("trace_id = ?");
      values.push(options.traceId);
    }
    if (options.status) {
      conditions.push("status = ?");
      values.push(options.status);
    }
    if (options.severity) {
      conditions.push(options.severity === "unknown" ? "severity IS NULL" : "severity = ?");
      if (options.severity !== "unknown") values.push(options.severity);
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const column = INCIDENT_SORT_COLUMNS[options.sort];
    const direction = options.direction === "asc" ? "ASC" : "DESC";
    const nullsLast = options.sort === "severity" ? `${column} IS NULL ASC, ` : "";
    const rows = this.db
      .prepare(
        `SELECT * FROM incidents${where}
         ORDER BY ${nullsLast}${column} ${direction}, id ${direction}
         LIMIT ? OFFSET ?`,
      )
      .all(...values, options.limit + 1, options.offset) as Row[];
    const counts = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open
         FROM incidents`,
      )
      .get() as { total: number; open: number | null };
    const severities = (
      this.db
        .prepare(
          "SELECT DISTINCT COALESCE(severity, 'unknown') AS severity FROM incidents ORDER BY severity",
        )
        .all() as Array<{ severity: string }>
    ).map((row) => row.severity);
    return {
      items: rows.slice(0, options.limit).map(rowToIncident),
      hasMore: rows.length > options.limit,
      totalCount: counts.total,
      openCount: counts.open ?? 0,
      severities,
    };
  }

  get(id: string): Incident | undefined {
    const row = this.db.prepare("SELECT * FROM incidents WHERE id = ?").get(id) as
      | Row
      | undefined;
    return row ? rowToIncident(row) : undefined;
  }

  getByAlert(alertFingerprint: string, traceId: string): Incident | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM incidents WHERE alert_fingerprint = ? AND trace_id = ?",
      )
      .get(alertFingerprint, traceId) as Row | undefined;
    return row ? rowToIncident(row) : undefined;
  }

  update(id: string, patch: Partial<Incident>): Incident | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    if (patch.status !== undefined && patch.status !== current.status) {
      this.assertTransition(current.status, patch.status);
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

  startVerification(
    id: string,
    input: { forkTraceId: string; mutation: Mutation; mutationHash: string },
    attempt?: Omit<IncidentForkAttempt, "forkTraceId" | "mutation" | "mutationHash">,
  ): Incident | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    if (current.traceId === input.forkTraceId) {
      throw new Error("fork trace must differ from the original trace");
    }
    if (current.status !== "verifying") this.assertTransition(current.status, "verifying");
    const forkAttempt: IncidentForkAttempt | undefined = attempt
      ? {
          ...attempt,
          forkTraceId: input.forkTraceId,
          mutation: input.mutation,
          mutationHash: input.mutationHash,
        }
      : undefined;
    const attempts = [...(current.forkAttempts ?? [])];
    if (forkAttempt) attempts.push(forkAttempt);
    this.db
      .prepare(
        `UPDATE incidents
         SET status = 'verifying',
             fork_trace_id = @forkTraceId,
             mutation_json = @mutation,
             mutation_hash = @mutationHash,
             verification_json = NULL,
             resolved_at = NULL,
             resolution_ms = NULL,
             fork_attempts_json = @forkAttempts
         WHERE id = @id`,
      )
      .run({
        id,
        forkTraceId: input.forkTraceId,
        mutation: JSON.stringify(input.mutation),
        mutationHash: input.mutationHash,
        forkAttempts: JSON.stringify(attempts),
      });
    return this.get(id);
  }

  finishVerification(id: string, verification: IncidentVerification): Incident | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    if (current.status !== "verifying") {
      throw new InvalidTransitionError(current.status, verification.verified ? "resolved" : "open");
    }
    const resolvedAt = verification.verified ? verification.checkedAt : null;
    const resolutionMs = verification.verified
      ? Math.max(0, Date.parse(verification.checkedAt) - Date.parse(current.createdAt))
      : null;
    const attempts = (current.forkAttempts ?? []).map((attempt) =>
      attempt.forkTraceId === current.forkTraceId
        ? { ...attempt, verification }
        : attempt,
    );
    this.db
      .prepare(
        `UPDATE incidents
         SET status = @status,
             verification_json = @verification,
             resolved_at = @resolvedAt,
             resolution_ms = @resolutionMs,
             fork_attempts_json = @forkAttempts
         WHERE id = @id`,
      )
      .run({
        id,
        status: verification.verified ? "resolved" : "open",
        verification: JSON.stringify(verification),
        resolvedAt,
        resolutionMs,
        forkAttempts: JSON.stringify(attempts),
      });
    return this.get(id);
  }

  openCountsByAgent(): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT agent_id, COUNT(*) AS c FROM incidents
         WHERE status IN ('open', 'verifying') GROUP BY agent_id`,
      )
      .all() as Array<{ agent_id: string; c: number }>;
    return new Map(rows.map((row) => [row.agent_id, row.c]));
  }

  close(): void {
    this.db.close();
  }

  private insert(incident: Incident): void {
    this.db
      .prepare(
        `INSERT INTO incidents (
           id, created_at, agent_id, trace_id, alert_name, severity, status,
           alert_fingerprint, failure_condition, run_id, source, fork_attempts_json
         ) VALUES (
           @id, @createdAt, @agentId, @traceId, @alertName, @severity, @status,
           @alertFingerprint, @failureCondition, @runId, @source, @forkAttempts
         )`,
      )
      .run({
        ...incident,
        severity: incident.severity ?? null,
        alertFingerprint: incident.alertFingerprint ?? null,
        failureCondition: incident.failureCondition ?? null,
        runId: incident.runId ?? null,
        source: incident.source ?? null,
        forkAttempts: JSON.stringify(incident.forkAttempts ?? []),
      });
  }

  private assertTransition(from: IncidentStatus, to: IncidentStatus): void {
    if (!TRANSITIONS[from].includes(to)) throw new InvalidTransitionError(from, to);
  }

  private addColumn(name: string, type: string): void {
    const columns = this.db.prepare("PRAGMA table_info(incidents)").all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === name)) {
      this.db.exec(`ALTER TABLE incidents ADD COLUMN ${name} ${type}`);
    }
  }
}

const INCIDENT_SORT_COLUMNS: Record<IncidentSortField, string> = {
  incident: "alert_name COLLATE NOCASE",
  severity: "severity COLLATE NOCASE",
  agent: "agent_id COLLATE NOCASE",
  detected: "created_at",
  status: "status",
};

function newIncident(input: CreateIncidentInput): Incident {
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    agentId: input.agentId ?? "unknown",
    traceId: input.traceId,
    runId: input.runId,
    source: input.source ?? "manual",
    alertName: input.alertName ?? "manual",
    severity: input.severity,
    status: "open",
    alertFingerprint: input.alertFingerprint,
    failureCondition: input.failureCondition,
  };
}

function rowToIncident(row: Row): Incident {
  return {
    id: row.id,
    createdAt: row.created_at,
    agentId: row.agent_id,
    traceId: row.trace_id,
    runId: row.run_id ?? undefined,
    source: row.source ?? undefined,
    alertName: row.alert_name,
    severity: row.severity ?? undefined,
    status: row.status as IncidentStatus,
    alertFingerprint: row.alert_fingerprint ?? undefined,
    failureCondition: row.failure_condition ?? undefined,
    forkTraceId: row.fork_trace_id ?? undefined,
    mutation: parseJson<Mutation>(row.mutation_json),
    mutationHash: row.mutation_hash ?? undefined,
    verification: parseJson<IncidentVerification>(row.verification_json),
    resolvedAt: row.resolved_at ?? undefined,
    resolutionMs: row.resolution_ms ?? undefined,
    forkAttempts: parseJson<IncidentForkAttempt[]>(row.fork_attempts_json) ?? [],
    notes: row.notes ?? undefined,
  };
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

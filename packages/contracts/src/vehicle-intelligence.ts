/**
 * Shared stubs for Nest vehicle intelligence v2 responses.
 */

/** Nest `GET /vehicle/:regNorm/timeline` event row when `status` is `"ok"`. */
export interface VehicleTimelineEvent {
  id: string;
  type: string;
  occurredAt: string;
  payload: unknown;
}

/** Nest `GET /vehicle/:regNorm/timeline`. */
export type VehicleTimelineResponse =
  | { status: "ok"; regNorm: string; events: VehicleTimelineEvent[] }
  | { status: "not_implemented"; regNorm: string; reason: string };

type VehicleRiskTier = "low" | "medium" | "high";

/** Nest `GET /vehicle/:regNorm/risk` — heuristic from compliance snapshot when available. */
export type VehicleRiskAssessment =
  | {
      regNorm: string;
      status: "ok";
      score: number;
      tier: VehicleRiskTier;
      band: VehicleRiskTier;
      signals: string[];
      reasons: string[];
      factors: Array<{
        key: string;
        label: string;
        weight: number;
        contribution: number;
        reason: string;
      }>;
      asOf: string;
    }
  | {
      regNorm: string;
      status: "not_found";
      score: null;
      tier: null;
      signals: [];
      asOf: string;
    }
  | {
      regNorm: string;
      status: "not_implemented";
      reason: string;
      score: null;
      tier: null;
      signals: [];
      asOf: string;
    };

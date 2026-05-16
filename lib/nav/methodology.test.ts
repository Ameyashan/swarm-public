import { test } from "node:test"
import assert from "node:assert/strict"
import {
  computeDailyMark,
  METHODOLOGY_VERSION,
  DAILY_RAIL_PCT,
  type DailyMarkInput,
} from "./methodology.ts"

function baseInput(overrides: Partial<DailyMarkInput> = {}): DailyMarkInput {
  return {
    fund_ticker: "GSCR",
    portfolio_company_canonical: "Acme Corp",
    mark_date: "2026-05-15",
    prior_fv: 10_000, // thousands
    fv_anchor: 10_000,
    weights: [
      { benchmark_code: "BAMLH0A0HYM2", weight: 0.5 },
      { benchmark_code: "BKLN", weight: 0.35 },
      { benchmark_code: "XLK", weight: 0.15 },
    ],
    benchmarks: [
      { series_code: "BAMLH0A0HYM2", value_today: 7.50, value_prior: 7.50, kind: "yield" },
      { series_code: "BKLN", value_today: 21.50, value_prior: 21.50, kind: "price" },
      { series_code: "XLK", value_today: 230.00, value_prior: 230.00, kind: "price" },
    ],
    duration_years: 3.5,
    alpha_dcf: 0.6,
    idio: { latest_severity_100: null },
    ...overrides,
  }
}

test("no movement → FV unchanged, blended spread delta is 0", () => {
  const out = computeDailyMark(baseInput())
  assert.equal(out.fair_value_estimated, 10_000)
  assert.equal(out.delta_bps, 0)
  assert.equal(out.requires_review, false)
  assert.equal(out.components.methodology_version, METHODOLOGY_VERSION)
  assert.equal(out.components.blended_spread_delta_bps, 0)
})

test("HY OAS widens 10bps → FV drops by duration × ΔSpread", () => {
  const out = computeDailyMark(
    baseInput({
      benchmarks: [
        { series_code: "BAMLH0A0HYM2", value_today: 7.60, value_prior: 7.50, kind: "yield" },
        { series_code: "BKLN", value_today: 21.50, value_prior: 21.50, kind: "price" },
        { series_code: "XLK", value_today: 230.00, value_prior: 230.00, kind: "price" },
      ],
    }),
  )
  // Pillar A: 10bps. Pillar B: 0.5*10 = 5bps. Blended: 0.6*10 + 0.4*5 = 8bps.
  // FV move: -3.5 × 0.0008 = -0.28%. New FV ≈ 9972.
  assert.ok(Math.abs(out.components.pillar_a_spread_delta_bps - 10) < 0.01)
  assert.ok(Math.abs(out.components.pillar_b_spread_delta_bps - 5) < 0.01)
  assert.ok(Math.abs(out.components.blended_spread_delta_bps - 8) < 0.01)
  assert.ok(out.fair_value_estimated < 10_000)
  assert.ok(out.fair_value_estimated > 9_960)
})

test("daily rail clamps a -5% modeled move to -2%", () => {
  // Force a huge HY OAS widening: +200bps. With duration 3.5, that would be
  // a -70% FV move, but the ±2% rail must clamp it.
  const out = computeDailyMark(
    baseInput({
      benchmarks: [
        { series_code: "BAMLH0A0HYM2", value_today: 9.50, value_prior: 7.50, kind: "yield" },
        { series_code: "BKLN", value_today: 21.50, value_prior: 21.50, kind: "price" },
        { series_code: "XLK", value_today: 230.00, value_prior: 230.00, kind: "price" },
      ],
    }),
  )
  const floor = 10_000 * (1 - DAILY_RAIL_PCT)
  assert.equal(out.fair_value_estimated, floor)
  assert.equal(out.components.rails_fired.daily_clamp_floor, true)
  assert.equal(out.requires_review, true)
  assert.ok(out.confidence === "low")
})

test("idio shock: severity 95 → -10% applied on top of model", () => {
  const out = computeDailyMark(
    baseInput({
      idio: { latest_severity_100: 95, age_days: 1 },
    }),
  )
  // No market move, so model leg = 10_000. Then ×(1 + (-0.10)) → 9_000.
  // But the daily rail clamps to 9_800. Confirm clamp fires.
  assert.equal(out.fair_value_estimated, 9_800)
  assert.ok(out.components.idio_shock_pct < 0)
  assert.equal(out.requires_review, true)
})

test("idio severity below 70 produces no shock", () => {
  const out = computeDailyMark(
    baseInput({
      idio: { latest_severity_100: 60, age_days: 1 },
    }),
  )
  assert.equal(out.components.idio_shock_pct, 0)
  assert.equal(out.requires_review, false)
})

test("stale idio (age > 5d) attenuates by half", () => {
  const fresh = computeDailyMark(
    baseInput({ idio: { latest_severity_100: 75, age_days: 1 } }),
  )
  const stale = computeDailyMark(
    baseInput({ idio: { latest_severity_100: 75, age_days: 9 } }),
  )
  assert.ok(Math.abs(fresh.components.idio_shock_pct) > Math.abs(stale.components.idio_shock_pct))
  assert.ok(Math.abs(stale.components.idio_shock_pct - fresh.components.idio_shock_pct / 2) < 1e-9)
})

test("missing benchmarks → low confidence, partial coverage handled", () => {
  const out = computeDailyMark(
    baseInput({
      benchmarks: [
        { series_code: "BAMLH0A0HYM2", value_today: 7.50, value_prior: 7.50, kind: "yield" },
        // BKLN and XLK missing
      ],
    }),
  )
  assert.equal(out.confidence, "low")
  // pillarB only weighted by 0.5 (HY portion). Total coverage = 0.5.
})

test("anchor-drift flag fires when |FV - anchor| > 10%", () => {
  // Prior FV is way below anchor — anchor_drift_pct should flag.
  const out = computeDailyMark(
    baseInput({ prior_fv: 8_500, fv_anchor: 10_000 }),
  )
  assert.equal(out.components.rails_fired.drift_vs_anchor, true)
  assert.equal(out.requires_review, true)
})

test("components JSONB carries all inputs for reproducibility", () => {
  const out = computeDailyMark(baseInput())
  assert.ok(out.components.methodology_version)
  assert.ok(Array.isArray(out.components.benchmark_trail))
  assert.equal(out.components.benchmark_trail.length, 3)
  for (const t of out.components.benchmark_trail) {
    assert.ok(t.series_code)
    assert.ok(typeof t.value_today === "number")
    assert.ok(typeof t.value_prior === "number")
  }
})

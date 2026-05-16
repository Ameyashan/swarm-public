-- Phase 4 follow-up — make tuning improvement legible at a glance.
--
-- tuned_minus_baseline_bps holds (tuned_median - baseline_median) in bps.
-- Negative = the tuner found weights that reduced drift below v1.0.0 defaults.
-- Zero = tuner kept baseline weights (no candidate beat default).
-- Positive should never appear — the tuner takes the best candidate ≤ baseline.

alter table public.methodology_industry_weights
  add column if not exists tuned_minus_baseline_bps numeric;

comment on column public.methodology_industry_weights.tuned_minus_baseline_bps is
  'Negative = real improvement vs v1.0.0 defaults. Zero = tuner kept defaults.';

-- Backfill from the v1.1.0 tuner run on 2026-05-16.
-- (Future tuner invocations will populate this field automatically.)
update public.methodology_industry_weights set tuned_minus_baseline_bps = v.delta
from (values
  ('software'::text,                              -36.022),
  ('health care providers & services',            -30.797),
  ('financial services',                          -35.009),
  ('diversified consumer services',               -40.945),
  ('professional services',                       -28.083),
  ('commercial services & supplies',                0.000),
  ('health care technology',                      -29.451),
  ('wireless telecommunication services',         -35.700),
  ('it services',                                 -36.281),
  ('health care equipment & supplies',             -9.429),
  ('trading companies & distributors',              0.000),
  ('chemicals',                                   -40.242)
) as v(industry, delta)
where methodology_industry_weights.methodology_version = 'v1.1.0'
  and methodology_industry_weights.industry = v.industry;

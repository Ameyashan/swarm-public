-- Third seed batch — adds verified via SEC EDGAR full-text search.
--
-- This is where seeding hits diminishing returns. The BDC universe is mostly
-- PE LBO portfolio companies funded by 144A private notes (no SEC reporting),
-- and most public-era borrowers stopped filing post-LBO. Additional manual
-- searches of well-known LBOs (UKG, Harbor Freight, Wilsonart, Mavis,
-- Quikrete, White Cap, Pregis, INEOS Styrolution, Pluralsight, Renaissance
-- Learning, NFP, Pike Electric, AmWINS, Charter NEX, Truist Insurance, Pactiv
-- subsidiaries, etc.) returned either no SEC presence or inactive CIKs.
--
-- After this batch, ~17 of ~480 borrowers (~3.5%) have CIK mappings. The
-- remainder will rely entirely on the GDELT headline branch of news-scan.

insert into borrower_cik (portfolio_company_canonical, cik, source, notes) values
  ('Medline Borrower, LP',                              '2046386', 'manual_seed_2026-05', 'Medline Inc. — S-1 filed 2025, IPO 424B4 late 2025'),
  ('Amentum Government Services Holdings LLC',          '2011286', 'manual_seed_2026-05', 'NYSE: AMTM — Amentum Holdings Inc., public Sept 2024 via Reverse Morris Trust')
on conflict (portfolio_company_canonical) do nothing;

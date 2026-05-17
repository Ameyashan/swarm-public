"""Generate Swarm Daily NAV methodology PDF + markdown for executive review.

Diagrams (matplotlib → PNG):
  1. Daily mark formula breakdown
  2. News event pipeline architecture
  3. Severity → idio shock mapping curve
  4. Universe coverage by source

PDF (reportlab Platypus): assembles text + diagrams into a print-ready doc.
"""

from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mp
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import numpy as np

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Register DejaVu Serif so Greek (Δ, α), arrows (→, ←), and ±/≥ glyphs
# render correctly in body text. Times-Roman lacks these.
_FONT_DIR = "/usr/share/fonts/truetype/dejavu"
_MPL_FONT_DIR = "/usr/local/lib/python3.11/dist-packages/matplotlib/mpl-data/fonts/ttf"
pdfmetrics.registerFont(TTFont("Body", f"{_FONT_DIR}/DejaVuSerif.ttf"))
pdfmetrics.registerFont(TTFont("Body-Bold", f"{_FONT_DIR}/DejaVuSerif-Bold.ttf"))
pdfmetrics.registerFont(TTFont("Body-Italic", f"{_MPL_FONT_DIR}/DejaVuSerif-Italic.ttf"))
pdfmetrics.registerFont(TTFont("Body-BoldItalic", f"{_MPL_FONT_DIR}/DejaVuSerif-BoldItalic.ttf"))
pdfmetrics.registerFont(TTFont("Mono", f"{_FONT_DIR}/DejaVuSansMono.ttf"))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily("Body", normal="Body", bold="Body-Bold",
                   italic="Body-Italic", boldItalic="Body-BoldItalic")
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak, Table,
    TableStyle, KeepTogether,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER

OUT_DIR = Path("/tmp/methodology_out")
OUT_DIR.mkdir(exist_ok=True)
PALETTE = {
    "gs": "#9B7A24",      # gold-olive
    "accent": "#3F6F8A",  # slate-blue
    "red": "#A0392B",
    "green": "#3F7A4B",
    "amber": "#B07A1F",
    "ink": "#222222",
    "bg": "#FAF6EC",
    "bg1": "#F2EAD1",
    "line": "#D6CFB8",
    "dim": "#7A7567",
}
plt.rcParams.update({
    "font.family": "DejaVu Serif",
    "font.size": 10,
    "axes.edgecolor": PALETTE["line"],
    "axes.labelcolor": PALETTE["ink"],
    "xtick.color": PALETTE["dim"],
    "ytick.color": PALETTE["dim"],
    "figure.facecolor": PALETTE["bg"],
    "axes.facecolor": PALETTE["bg"],
})


# ─────────────────────────────────────────────────────────────────────────────
# Diagram 1 — Daily mark formula flow
# ─────────────────────────────────────────────────────────────────────────────

def fig_mark_formula():
    fig, ax = plt.subplots(figsize=(9, 5.2))
    ax.set_xlim(0, 10); ax.set_ylim(0, 6)
    ax.axis("off")

    def box(x, y, w, h, label, sub=None, color=PALETTE["bg1"], edge=PALETTE["line"]):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.04,rounding_size=0.12",
                                    fc=color, ec=edge, lw=0.8))
        ax.text(x + w/2, y + h/2 + (0.15 if sub else 0), label,
                ha="center", va="center", fontsize=10.5, color=PALETTE["ink"])
        if sub:
            ax.text(x + w/2, y + h/2 - 0.22, sub, ha="center", va="center",
                    fontsize=8.5, color=PALETTE["dim"], style="italic")

    def arrow(x1, y1, x2, y2, label=None):
        ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                    arrowprops=dict(arrowstyle="->", color=PALETTE["dim"], lw=0.9))
        if label:
            ax.text((x1 + x2)/2 + 0.05, (y1 + y2)/2 + 0.08, label,
                    fontsize=8, color=PALETTE["dim"], style="italic")

    # Inputs row
    box(0.2, 4.5, 2.4, 0.9, "Pillar A: DCF",
        sub="HY OAS spread Δ × duration",
        color="#EFE4C3")
    box(3.0, 4.5, 2.4, 0.9, "Pillar B: Market",
        sub="ETF/OAS basket weighted",
        color="#E0E8EE")
    box(5.8, 4.5, 2.4, 0.9, "Idio overlay",
        sub="news severity → shock %",
        color="#EDD9D3")
    # Blend
    box(2.0, 3.0, 3.4, 0.9,
        "Blended spread Δ (bps)",
        sub="α·A + (1−α)·B,   α≈0.4",
        color=PALETTE["bg1"])
    arrow(1.4, 4.5, 3.0, 3.9)
    arrow(4.2, 4.5, 3.7, 3.9)

    # FV move
    box(2.0, 1.7, 3.4, 0.9,
        "ΔFV = −duration × Δbps / 10,000",
        sub="prior FV × (1 + ΔFV)",
        color=PALETTE["bg1"])
    arrow(3.7, 3.0, 3.7, 2.6)

    # Idio applied
    box(5.8, 3.0, 2.4, 0.9, "Apply idio shock",
        sub="FV × (1 + idio %)",
        color="#EDD9D3")
    arrow(7.0, 4.5, 7.0, 3.9)
    arrow(5.4, 2.15, 5.8, 3.0, "FV-after-spreads")

    # Rails
    box(5.8, 1.7, 2.4, 0.9, "Daily clamp ±2%",
        sub="anchor-drift flag at ±10%",
        color="#EDE2C8")
    arrow(7.0, 3.0, 7.0, 2.6)

    # Final
    box(2.0, 0.3, 6.2, 0.9, "Decision-support mark",
        sub="written to daily_marks · components JSONB pins every input",
        color="#D6E0D2")
    arrow(3.7, 1.7, 3.7, 1.2)
    arrow(7.0, 1.7, 7.0, 1.2)

    ax.text(5, 5.85, "Daily NAV mark — calculation flow",
            ha="center", fontsize=12, color=PALETTE["ink"], weight="bold")
    fig.tight_layout()
    p = OUT_DIR / "fig_mark_formula.png"
    fig.savefig(p, dpi=180, bbox_inches="tight", facecolor=PALETTE["bg"])
    plt.close(fig)
    return p


# ─────────────────────────────────────────────────────────────────────────────
# Diagram 2 — News event pipeline architecture
# ─────────────────────────────────────────────────────────────────────────────

def fig_news_pipeline():
    fig, ax = plt.subplots(figsize=(9, 5.5))
    ax.set_xlim(0, 10); ax.set_ylim(0, 6.5)
    ax.axis("off")

    def box(x, y, w, h, label, sub=None, color=PALETTE["bg1"]):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.04,rounding_size=0.12",
                                    fc=color, ec=PALETTE["line"], lw=0.8))
        ax.text(x + w/2, y + h/2 + (0.18 if sub else 0), label,
                ha="center", va="center", fontsize=10.5, color=PALETTE["ink"])
        if sub:
            ax.text(x + w/2, y + h/2 - 0.22, sub, ha="center", va="center",
                    fontsize=8.2, color=PALETTE["dim"], style="italic")

    def arrow(x1, y1, x2, y2, label=None, offset=(0.05, 0.08)):
        ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                    arrowprops=dict(arrowstyle="->", color=PALETTE["dim"], lw=0.9))
        if label:
            ax.text((x1 + x2)/2 + offset[0], (y1 + y2)/2 + offset[1], label,
                    fontsize=8, color=PALETTE["dim"], style="italic")

    ax.text(5, 6.15, "News-event detection pipeline (14:30 UTC daily)",
            ha="center", fontsize=12, color=PALETTE["ink"], weight="bold")

    # Sources row
    box(0.1, 4.7, 2.2, 0.9, "SEC EDGAR", sub="17 borrowers · 8-K items", color="#E0E8EE")
    box(2.6, 4.7, 2.2, 0.9, "GDELT", sub="all 613 aliases", color="#E0E8EE")
    box(5.1, 4.7, 2.2, 0.9, "Google News RSS", sub="all 613 aliases", color="#E0E8EE")
    box(7.6, 4.7, 2.3, 0.9, "borrower_alias", sub="dba/aka/fka + stripped", color="#EDE2C8")

    # Ingestion
    box(0.5, 3.2, 7.0, 0.9, "news_items (deduped via source + source_id)",
        sub="universe = GSCR + GSBD borrowers",
        color=PALETTE["bg1"])
    arrow(1.2, 4.7, 1.6, 4.1)
    arrow(3.7, 4.7, 3.4, 4.1)
    arrow(6.2, 4.7, 5.2, 4.1)
    arrow(8.7, 4.7, 6.0, 4.1, label="lookup")

    # Scoring
    box(0.5, 1.8, 3.2, 0.9, "Rules-first scoring",
        sub="bankruptcy=95 · default=90 · downgrade=78",
        color="#EFE4C3")
    box(4.3, 1.8, 3.2, 0.9, "LLM fallback (Haiku)",
        sub="gated by risk-keyword pre-filter",
        color="#EDD9D3")
    arrow(2.0, 3.2, 2.0, 2.7)
    arrow(5.9, 3.2, 5.9, 2.7, label="if no rule match")

    # Detector hits
    box(0.5, 0.4, 7.0, 0.9, "detector_hits  (severity ≥ 70 only)",
        sub="detector_name='news_event' · feeds daily NAV runner at 15:00 UTC",
        color="#D6E0D2")
    arrow(2.0, 1.8, 2.0, 1.3)
    arrow(5.9, 1.8, 5.9, 1.3)

    fig.tight_layout()
    p = OUT_DIR / "fig_news_pipeline.png"
    fig.savefig(p, dpi=180, bbox_inches="tight", facecolor=PALETTE["bg"])
    plt.close(fig)
    return p


# ─────────────────────────────────────────────────────────────────────────────
# Diagram 3 — Severity → idio shock curve
# ─────────────────────────────────────────────────────────────────────────────

def fig_severity_curve():
    fig, ax = plt.subplots(figsize=(8, 4.5))
    sev = np.linspace(60, 100, 401)
    shock = np.zeros_like(sev)
    for i, s in enumerate(sev):
        if s < 70:
            shock[i] = 0
        elif s < 85:
            shock[i] = -0.01 + ((-0.05 + 0.01) * (s - 70)) / 15
        elif s < 95:
            shock[i] = -0.05 + ((-0.10 + 0.05) * (s - 85)) / 10
        else:
            shock[i] = -0.10
    ax.plot(sev, shock * 100, color=PALETTE["red"], lw=2.2)
    ax.fill_between(sev, shock * 100, 0, where=(sev >= 70),
                    color=PALETTE["red"], alpha=0.07)
    ax.axhline(0, color=PALETTE["line"], lw=0.6)
    ax.axvline(70, color=PALETTE["line"], lw=0.6, linestyle="--")
    ax.axvline(85, color=PALETTE["line"], lw=0.6, linestyle="--")
    ax.axvline(95, color=PALETTE["line"], lw=0.6, linestyle="--")

    # Anchor annotations
    anchors = [
        (70, -1, "70 · earnings miss"),
        (78, -2.9, "78 · downgrade"),
        (88, -7, "88 · default / going concern"),
        (95, -10, "95 · bankruptcy"),
    ]
    for x, y, label in anchors:
        ax.annotate(label, xy=(x, y), xytext=(x + 1.2, y + 1.6),
                    fontsize=9, color=PALETTE["ink"],
                    arrowprops=dict(arrowstyle="->", color=PALETTE["dim"], lw=0.7))

    ax.set_xlabel("severity score (0–100)")
    ax.set_ylabel("idio shock applied to FV (%)")
    ax.set_title("News severity → idio shock mapping",
                 color=PALETTE["ink"], fontsize=12, weight="bold", pad=10)
    ax.set_xlim(60, 100)
    ax.set_ylim(-11.5, 1.5)
    ax.text(62, -10.8, "<70: ignored (filtered)", fontsize=8.5, color=PALETTE["dim"], style="italic")
    fig.tight_layout()
    p = OUT_DIR / "fig_severity_curve.png"
    fig.savefig(p, dpi=180, bbox_inches="tight", facecolor=PALETTE["bg"])
    plt.close(fig)
    return p


# ─────────────────────────────────────────────────────────────────────────────
# Diagram 4 — universe coverage by source
# ─────────────────────────────────────────────────────────────────────────────

def fig_coverage():
    fig, ax = plt.subplots(figsize=(8, 4.2))
    sources = ["SEC EDGAR\n(8-K filers)", "GDELT\n(headlines)", "Google News\n(RSS)"]
    counts = [17, 613, 613]
    pct = [c / 627 * 100 for c in counts]
    colors_ = [PALETTE["accent"], PALETTE["gs"], PALETTE["green"]]
    bars = ax.bar(sources, pct, color=colors_, edgecolor=PALETTE["ink"], linewidth=0.6, width=0.55)
    for b, c, p in zip(bars, counts, pct):
        ax.text(b.get_x() + b.get_width()/2, b.get_height() + 1.5,
                f"{c} of 627\n({p:.1f}%)", ha="center", fontsize=10, color=PALETTE["ink"])
    ax.set_ylim(0, 115)
    ax.set_ylabel("coverage (% of borrower universe)")
    ax.set_title("Universe coverage by news source — GSCR + GSBD (627 borrowers)",
                 color=PALETTE["ink"], fontsize=12, weight="bold", pad=10)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f"{int(x)}%"))
    ax.spines[["right", "top"]].set_visible(False)
    fig.tight_layout()
    p = OUT_DIR / "fig_coverage.png"
    fig.savefig(p, dpi=180, bbox_inches="tight", facecolor=PALETTE["bg"])
    plt.close(fig)
    return p


# ─────────────────────────────────────────────────────────────────────────────
# Assemble PDF
# ─────────────────────────────────────────────────────────────────────────────

def build_pdf(out_path: Path):
    figs = {
        "formula": fig_mark_formula(),
        "pipeline": fig_news_pipeline(),
        "severity": fig_severity_curve(),
        "coverage": fig_coverage(),
    }

    styles = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=styles["BodyText"],
                          fontName="Body", fontSize=10.5, leading=14.5,
                          spaceAfter=6, textColor=colors.HexColor("#222222"))
    h1 = ParagraphStyle("h1", parent=styles["Heading1"],
                        fontName="Body-Bold", fontSize=18, leading=22,
                        spaceBefore=4, spaceAfter=10, textColor=colors.HexColor("#222222"))
    h2 = ParagraphStyle("h2", parent=styles["Heading2"],
                        fontName="Body-Bold", fontSize=13.5, leading=17,
                        spaceBefore=14, spaceAfter=6, textColor=colors.HexColor("#222222"))
    small = ParagraphStyle("small", parent=body, fontSize=9, leading=12,
                           textColor=colors.HexColor("#7A7567"))
    mono = ParagraphStyle("mono", parent=body, fontName="Mono", fontSize=9, leading=12)
    cover_title = ParagraphStyle("ct", parent=h1, fontSize=26, leading=32, alignment=TA_LEFT)
    cover_sub = ParagraphStyle("cs", parent=body, fontSize=12, leading=16,
                               textColor=colors.HexColor("#7A7567"), spaceBefore=4)
    caption = ParagraphStyle("cap", parent=small, alignment=TA_CENTER, spaceBefore=2, spaceAfter=14)

    doc = SimpleDocTemplate(str(out_path), pagesize=letter,
                            leftMargin=0.85*inch, rightMargin=0.85*inch,
                            topMargin=0.9*inch, bottomMargin=0.9*inch,
                            title="Swarm — Daily NAV Methodology",
                            author="Swarm")

    s = []

    # ── Cover ──
    s.append(Spacer(1, 1.4*inch))
    s.append(Paragraph("Swarm Daily NAV", cover_title))
    s.append(Paragraph("Methodology &amp; Dashboard", cover_title))
    s.append(Spacer(1, 0.2*inch))
    s.append(Paragraph(
        "A decision-support marking framework for private-credit BDC positions, "
        "combining benchmark spread movements with a daily news-event idiosyncratic overlay. "
        "Pinned per row in <font face='Mono'>daily_marks.methodology_version</font> "
        "so every mark is reproducible.",
        cover_sub))
    s.append(Spacer(1, 0.4*inch))
    s.append(Paragraph("Prepared for executive review — 2026-05-17", small))
    s.append(Paragraph("Not a 40-Act fair-value mark. Decision-support only.", small))
    s.append(PageBreak())

    # ── 1. What this is ──
    s.append(Paragraph("1. What this is", h1))
    s.append(Paragraph(
        "Swarm produces a <b>daily decision-support mark</b> for every borrower in "
        "the GSCR and GSBD BDC portfolios (~617 borrowers, ~2,300 individual positions). "
        "Unlike the quarterly fair-value mark required by the 40-Act, this daily mark "
        "is built for in-quarter risk management: it triangulates today's price move "
        "from three independent signals and flags borrowers that drift materially from "
        "their last reported FV.",
        body))
    s.append(Paragraph(
        "The output sits behind the <b>Daily NAV</b> tab on the dashboard. Each row is "
        "clickable and opens a methodology drawer that shows every input that produced "
        "the mark — the benchmark spread moves, the DCF/market blend, any idio overlay, "
        "and which rails (if any) fired.",
        body))

    s.append(Paragraph("Three pillars", h2))
    pillar_table = Table(
        [
            [Paragraph("<b>Pillar A — DCF</b>", body),
             Paragraph("Discounts the position's cash flows using the high-yield OAS curve as a proxy for the obligor's discount rate. Picks up changes in the broad credit-cycle discount rate.", body)],
            [Paragraph("<b>Pillar B — Market comps</b>", body),
             Paragraph("Weighted basket of public benchmark moves (HY OAS series, sector ETFs, BDC ETFs) calibrated to the borrower's industry, seniority, and duration. Picks up sector- and rating-specific price moves.", body)],
            [Paragraph("<b>Idiosyncratic overlay</b>", body),
             Paragraph("News-driven shock when an event (bankruptcy, default, downgrade, covenant breach, etc.) fires on the borrower. Captures borrower-specific risk that benchmarks miss.", body)],
        ],
        colWidths=[1.6*inch, 4.7*inch],
    )
    pillar_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#D6CFB8")),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, colors.HexColor("#D6CFB8")),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F2EAD1")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    s.append(pillar_table)
    s.append(PageBreak())

    # ── 2. The formula ──
    s.append(Paragraph("2. How a daily mark is calculated", h1))
    s.append(Paragraph(
        "Every weekday at 15:00 UTC, the mark-positions cron reads the prior day's "
        "fair value for each position, pulls today's benchmark snapshots, applies the "
        "methodology, and writes a new row to <font face='Mono'>daily_marks</font>. "
        "Each row carries a JSONB <font face='Mono'>components</font> field "
        "with every input value, so the mark is fully reproducible.",
        body))
    s.append(Image(str(figs["formula"]), width=6.5*inch, height=3.6*inch))
    s.append(Paragraph("Figure 1. Daily mark calculation flow.", caption))

    s.append(Paragraph("Step-by-step", h2))
    steps = [
        ("<b>Pillar A — DCF spread Δ</b>", "Today's change in the BAML HY OAS index, in bps. Direct read from the FRED snapshot."),
        ("<b>Pillar B — market-comp spread Δ</b>", "For each benchmark in the position's weight map, convert today's price change to an implied spread Δ (using a duration proxy for ETFs, raw delta for yield series), then weight by the position's mapped weight. Sum to get pillar B in bps."),
        ("<b>Blend</b>", "<font face='Mono'>blended Δ bps = α · pillar_A + (1 − α) · pillar_B</font>. α (the DCF weight) is ~0.4 by default, tunable per industry via the tuner."),
        ("<b>FV move from spreads</b>", "<font face='Mono'>FV move % = −duration × blended_bps / 10,000</font>. Apply: <font face='Mono'>FV = prior_FV × (1 + FV_move_%)</font>."),
        ("<b>Idiosyncratic overlay</b>", "If a news event fired on this borrower in the last 5 days with severity ≥ 70, apply <font face='Mono'>FV ← FV × (1 + idio_shock_%)</font>. Severity-to-shock mapping is shown in Figure 3."),
        ("<b>Daily clamp</b>", "Hard cap at ±2% intraday move vs. prior FV. Anything beyond clamps and sets a rail flag."),
        ("<b>Anchor-drift check</b>", "Compare today's modeled FV against the last reported FV (the 'anchor', from the most recent quarterly observation). Drift &gt; 10% sets a review flag — borrower needs PM attention."),
    ]
    step_table = Table(
        [[Paragraph(t, body), Paragraph(d, body)] for t, d in steps],
        colWidths=[1.5*inch, 4.8*inch],
    )
    step_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, colors.HexColor("#D6CFB8")),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    s.append(step_table)
    s.append(PageBreak())

    # ── 3. News pipeline ──
    s.append(Paragraph("3. News-event idiosyncratic signal", h1))
    s.append(Paragraph(
        "The benchmark pillars capture <i>market</i> moves but miss <i>borrower-specific</i> "
        "events — a covenant amendment, a 8-K bankruptcy filing, a downgrade announcement. "
        "The news pipeline ingests headlines from three sources every morning before the "
        "marking cron runs, scores them deterministically, and writes severity ≥ 70 events "
        "into the detector_hits table that the marking runner already consumes.",
        body))
    s.append(Image(str(figs["pipeline"]), width=6.6*inch, height=4*inch))
    s.append(Paragraph("Figure 2. News-event detection pipeline. Runs at 14:30 UTC, 30 min before the marking cron.", caption))

    s.append(Paragraph("Sources", h2))
    s.append(Paragraph(
        "<b>SEC EDGAR 8-K filings</b> — high-precision structured signal for the ~17 borrowers "
        "in the universe that are public filers or maintain SEC registration for high-yield "
        "bondholders. Each 8-K's filed item codes map deterministically to severity (Item 1.03 "
        "bankruptcy → 95, Item 4.02 restatement → 82, etc.).", body))
    s.append(Paragraph(
        "<b>GDELT</b> — free generalist news indexer. Queries each borrower alias once per day. "
        "Coverage of private borrowers is patchy; included for breadth.", body))
    s.append(Paragraph(
        "<b>Google News RSS</b> — free, broader trade-press coverage. Catches the private-LBO "
        "news that GDELT frequently misses (lender-letter coverage, covenant-amendment leaks, "
        "distress reporting).", body))

    s.append(Image(str(figs["coverage"]), width=6.5*inch, height=3.4*inch))
    s.append(Paragraph("Figure 3. Coverage of the borrower universe by news source.", caption))
    s.append(PageBreak())

    # ── 4. Severity mapping ──
    s.append(Paragraph("4. From severity score to idio shock", h1))
    s.append(Paragraph(
        "Each news event is scored on a 0–100 severity scale, calibrated against the kinds "
        "of credit events PMs care about. Scoring happens in two passes:",
        body))
    s.append(Paragraph(
        "<b>Rules-first</b> — deterministic regex over the headline ('chapter 11', "
        "'payment default', 'covenant breach', 'downgrade', 'lay off', etc.) and 8-K item "
        "codes. Free, predictable, ~70% of events resolve here.",
        body))
    s.append(Paragraph(
        "<b>LLM fallback</b> — anything not matched by rules but containing a risk-adjacent "
        "keyword AND mentioning the borrower name is sent to Claude Haiku for a "
        "<font face='Mono'>{severity, reason}</font> response. Bounded by a keyword "
        "pre-filter to keep costs sub-$15/month.",
        body))
    s.append(Spacer(1, 0.15*inch))
    s.append(Image(str(figs["severity"]), width=6.5*inch, height=3.7*inch))
    s.append(Paragraph(
        "Figure 4. Severity score → idio shock applied to fair value. "
        "Events below severity 70 are ignored entirely.",
        caption))

    s.append(Paragraph("Why these anchor points", h2))
    s.append(Paragraph(
        "Bankruptcy and default are unambiguous credit events — a −5% to −10% intraday "
        "mark is consistent with how dealers actually trade distressed paper. Downgrades "
        "and layoffs are softer signals that warrant a smaller adjustment. Anything below "
        "70 is ambiguous enough that we'd rather miss a real signal than create false alarms.",
        body))
    s.append(PageBreak())

    # ── 5. Dashboard ──
    s.append(Paragraph("5. What the dashboard shows", h1))
    s.append(Paragraph("Daily NAV tab", h2))
    s.append(Paragraph(
        "The main table lists every position with today's mark, the Δ bps vs. prior, "
        "a 30-day mark trajectory sparkline, and a confidence flag (low/med/high). "
        "Sortable by borrower, fund (GSCR/GSBD), today's FV, Δ bps, mark %, confidence, "
        "or review flag. Filters: down today / up today / review queue.",
        body))
    s.append(Paragraph(
        "<b>Visual cues:</b> red Δ bps for moves &lt; −150 bps; amber for −150 to −50; "
        "the pillar bar visualises how today's move decomposes across DCF, market-comp, "
        "and any idio shock. A row flagged for review (rail fired, anchor drift &gt; 10%, "
        "or new idio shock) routes to the review queue.",
        body))

    s.append(Paragraph("Methodology drawer", h2))
    s.append(Paragraph(
        "Clicking any row opens a drawer showing the complete component breakdown:",
        body))
    drawer_items = [
        "Prior FV, today FV, anchor FV, anchor drift % — the four key numbers, with thousand separators.",
        "Spread delta triangulation — α weight, position duration, pillar A bps, pillar B bps, blended bps.",
        "Benchmark inputs — every series in the weight map with its prior, today, and Δ bps.",
        "Overlay + rails — idio shock %, daily floor/ceiling fired (yes/no), anchor-drift flag.",
        "Overrides — list of any PM-submitted manual overrides (audit-only — never mutates the source mark), plus an override form.",
    ]
    for it in drawer_items:
        s.append(Paragraph(f"• {it}", body))

    s.append(Paragraph("Override workflow", h2))
    s.append(Paragraph(
        "When the model is wrong (it will be — illiquid private credit isn't a solved "
        "problem), the PM can submit an override from the drawer: override %, reason (free text), "
        "approver name. Overrides are <b>audit-only</b>: they're written to a separate "
        "<font face='Mono'>mark_overrides</font> table and never modify "
        "<font face='Mono'>daily_marks</font>. Each override moves through "
        "pending → approved/rejected. The full audit trail is preserved.",
        body))
    s.append(PageBreak())

    # ── 6. Governance ──
    s.append(Paragraph("6. Governance &amp; limitations", h1))
    s.append(Paragraph("What this is not", h2))
    s.append(Paragraph(
        "This is <b>not a 40-Act fair-value mark.</b> The 40-Act mark continues to come "
        "from the quarterly board-approved valuation process. The daily mark is "
        "decision-support — it surfaces moves that warrant attention between quarterly "
        "marks and gives PMs a defensible in-quarter view.",
        body))

    s.append(Paragraph("Rails &amp; flags", h2))
    s.append(Paragraph(
        "Three governance rails are baked into every mark:",
        body))
    s.append(Paragraph(
        "<b>Daily clamp ±2%</b> — caps intraday moves. A model that wants to move a position "
        "5% in a day gets clamped to 2% and the row is flagged for review. Prevents data-error "
        "blow-ups from contaminating the book.",
        body))
    s.append(Paragraph(
        "<b>Anchor drift &gt; 10%</b> — when the cumulative modeled drift from the last "
        "reported FV exceeds 10%, the row is flagged. This catches cases where the anchor "
        "is stale (pre-downgrade) and the model is correctly diverging.",
        body))
    s.append(Paragraph(
        "<b>Idio overlay fires → low confidence</b> — any row with a non-zero idio shock is "
        "automatically downgraded to 'low' confidence so PMs know not to trust it blindly.",
        body))

    s.append(Paragraph("Reproducibility", h2))
    s.append(Paragraph(
        "Every <font face='Mono'>daily_marks</font> row pins the methodology version it was "
        "produced with. Old marks remain reproducible because the formula version is "
        "captured alongside the inputs. When we tune α or change benchmark weights, the new "
        "version writes alongside the old; no historical marks are modified.",
        body))

    s.append(Paragraph("Cost", h2))
    s.append(Paragraph(
        "All free except the optional LLM fallback for news classification, which is gated "
        "by a keyword pre-filter and runs against Claude Haiku 4.5. Realistic monthly "
        "cost ≤ $15 even with the full universe. Without the LLM branch (rules-only) the "
        "system runs at zero variable cost.",
        body))

    s.append(Paragraph("Coverage caveats", h2))
    s.append(Paragraph(
        "Of ~617 borrowers, only ~17 are SEC filers, so the high-precision EDGAR branch "
        "covers ~3% of the universe. The remaining ~97% rely on GDELT and Google News, "
        "which are noisier but free. The natural next step if PMs want higher signal-to-noise "
        "is a paid trade-press feed (9fin, Reorg) for the distressed-watchlist subset of "
        "borrowers.",
        body))

    doc.build(s)
    return out_path


pdf_path = build_pdf(OUT_DIR / "swarm_methodology.pdf")
print(f"PDF: {pdf_path}  ({pdf_path.stat().st_size // 1024} KB)")

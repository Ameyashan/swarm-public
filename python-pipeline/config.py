"""Pipeline configuration constants.

These are deliberately lightweight — anything secret should live in environment
variables (loaded by the orchestrator), not here.
"""

# SEC EDGAR requires a descriptive User-Agent identifying the requester.
# https://www.sec.gov/os/accessing-edgar-data
USER_AGENT = "Swarm Public ameya.shanbhag@gmail.com"

# JSON submission feeds and structured data.
EDGAR_BASE = "https://data.sec.gov"

# Filed documents (HTML, exhibits, etc).
ARCHIVES_BASE = "https://www.sec.gov/Archives"

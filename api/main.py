"""
MPLADS-Sentinel | Phase 2: Core Integrity Engine & FastAPI Backend

Run:
    uvicorn api.main:app --reload --port 8000        (from repo root)

Endpoints:
    POST /ingest        CSV (multipart) or JSON array -> validated -> SQLite; rejects quarantined
    GET  /quarantine    In-memory rejects with reasons
    GET  /score         Full engine scan -> risk register
    GET  /stats         National KPIs
    GET  /mp/{mp_id}    MP portfolio drill-down
    GET  /health

The engine (`run_engine`) is importable by the Streamlit cockpit for air-gapped
offline mode when the API is not running.
"""

from __future__ import annotations

import io
import json
import os
import sqlite3
from datetime import date, datetime
from typing import Any, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware 
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError, field_validator
from rapidfuzz import fuzz, process
from sklearn.ensemble import IsolationForest
from collections import Counter
import networkx as nx
from scipy.stats import chisquare

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.environ.get("MPLADS_DB", os.path.join(BASE_DIR, "mplads.db"))
GT_PATH = os.environ.get("MPLADS_GT", os.path.join(BASE_DIR, "ground_truth.csv"))

# Frozen audit date so demo runs are reproducible. Override with env AUDIT_DATE=YYYY-MM-DD.
AUDIT_DATE = date.fromisoformat(os.environ.get("AUDIT_DATE", "2026-03-01"))

ANNUAL_CAP_LAKHS = 500.0        # ₹5 Crore MP entitlement per fiscal year
COST_MULTIPLIER = 2.5           # R03 benchmark
SPEED_DAYS = 7                  # R05
STALE_DAYS = 365                # R06
ABANDON_DAYS = 180              # R11
VENDOR_SHARE = 0.60             # R08
VENDOR_CONSECUTIVE = 8          # R08 (strictly greater)
MICRO_SPLIT_THRESHOLD = 10.0    # R09 ₹ Lakhs approval threshold
MICRO_SPLIT_MIN_COUNT = 3       # R09
DUP_RATIO = 85                  # R10 token_set_ratio gate (spec)
DUP_CHAR_RATIO = 88             # R10 corroboration: character-level fuzz.ratio
DUP_AMOUNT_GAP = 0.15           # R10 corroboration: sanctioned amounts within ±15%
DUP_DAY_GAP = 180               # R10 corroboration: sanctions within 180 days
IF_CONTAMINATION = 0.05
SEED = 42

RULE_WEIGHTS: dict[str, int] = {
    "R01": 50, "R02": 10, "R03": 45, "R04": 55, "R05": 55, "R06": 12,
    "R07": 45, "R08": 45, "R09": 30, "R10": 50, "R11": 10, "R12": 8,
    "R13": 20, "R14": 45, "R15": 40,"R16": 40,
}
RULE_WEIGHT_R10_REVIEW = 8      # Uncorroborated text similarity -> review only

RULE_LABELS: dict[str, str] = {
    "R01": "Over-Release",
    "R02": "Annual Cap Breach",
    "R03": "Cost Benchmark Anomaly",
    "R04": "Impossible Accounting",
    "R05": "Speed Fraud",
    "R06": "Stale Stagnation",
    "R07": "Future Dating",
    "R08": "Vendor Dominance",
    "R09": "Micro-Splitting",
    "R10": "Duplicate Work",
    "R11": "Abandoned Work",
    "R12": "Missing Audit Metadata",
    "R13": "EXIF Metadata Tampered",
    "R14": "Geofence Mismatch",
    "R15": "Cartel Linkage",
    "R16": "Puppeteer Synchrony"
}

REQUIRED_COLUMNS = [
    "work_id", "mp_id", "mp_name", "state", "district", "block", "work_category",
    "work_description", "sanctioned_amount", "released_amount", "vendor_id",
    "vendor_name", "sanction_date", "completion_date", "status", "fiscal_year",
    "implementing_agency", "geotag_uploaded",
]
KYC_COLUMNS = [
    "pan_card", "bank_account_number", "director_name",
    "official_project_latitude", "official_project_longitude",
    "photo_latitude", "photo_longitude", "photo_metadata_stripped",
]
REQUIRED_COLUMNS += KYC_COLUMNS

VALID_STATUS = {"Completed", "In Progress", "Sanctioned"}
VALID_CATEGORIES = {"Drinking Water", "Education Infrastructure", "Roads & Bridges", "Public Health", "Sanitation"}


# ---------------------------------------------------------------------------
# Ingestion gate: Pydantic schema
# ---------------------------------------------------------------------------
class WorkRecord(BaseModel):
    work_id: str = Field(min_length=3, max_length=40)
    mp_id: str = Field(min_length=3, max_length=40)
    mp_name: str
    state: str
    district: str
    block: Optional[str] = None
    work_category: Optional[str] = None
    work_description: str = Field(min_length=5)
    sanctioned_amount: float
    released_amount: float
    vendor_id: Optional[str] = None
    vendor_name: Optional[str] = None
    sanction_date: date
    completion_date: Optional[date] = None
    status: str
    fiscal_year: Optional[str] = None
    implementing_agency: Optional[str] = None
    geotag_uploaded: int = 0
    pan_card: Optional[str] = None
    bank_account_number: Optional[str] = None
    director_name: Optional[str] = None
    official_project_latitude: Optional[float] = None
    official_project_longitude: Optional[float] = None
    photo_latitude: Optional[float] = None
    photo_longitude: Optional[float] = None
    photo_metadata_stripped: int = 0

    @field_validator("status")
    @classmethod
    def _status_ok(cls, v: str) -> str:
        if v not in VALID_STATUS:
            raise ValueError(f"status must be one of {sorted(VALID_STATUS)}")
        return v

    @field_validator("work_category")
    @classmethod
    def _category_ok(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_CATEGORIES:
            raise ValueError(f"work_category '{v}' not in MoSPI guideline list")
        return v

    @field_validator(
        "block", "vendor_id", "vendor_name", "work_category", "fiscal_year",
        "completion_date", "implementing_agency", mode="before",
    )
    @classmethod
    def _nan_to_none(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, float) and np.isnan(v):
            return None
        if isinstance(v, str) and v.strip().lower() in {"", "nan", "null", "none", "nat"}:
            return None
        return v

    @field_validator("geotag_uploaded", mode="before")
    @classmethod
    def _geotag(cls, v: Any) -> int:
        if v is None or (isinstance(v, float) and np.isnan(v)) or (isinstance(v, str) and v.strip() == ""):
            return 0
        try:
            return 1 if int(float(v)) else 0
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"geotag_uploaded '{v}' must be 0/1") from exc

    @field_validator("sanctioned_amount", "released_amount", mode="before")
    @classmethod
    def _numeric(cls, v: Any) -> float:
        if v is None or (isinstance(v, float) and np.isnan(v)):
            raise ValueError("amount is required")
        try:
            return float(str(v).replace(",", "").replace("₹", "").strip())
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"amount '{v}' is not numeric") from exc


def _fiscal_year(d: date) -> str:
    return f"FY{d.year}-{str(d.year + 1)[-2:]}" if d.month >= 4 else f"FY{d.year - 1}-{str(d.year)[-2:]}"


def validate_frame(raw: pd.DataFrame) -> tuple[pd.DataFrame, list[dict]]:
    """Row-level Pydantic validation. Returns (clean_df, rejects)."""
    missing = [c for c in ["work_id", "mp_id", "sanctioned_amount", "released_amount", "sanction_date", "status"] if c not in raw.columns]
    if missing:
        raise HTTPException(status_code=422, detail=f"Ledger missing mandatory columns: {missing}")

    for col in REQUIRED_COLUMNS:
        if col not in raw.columns:
            raw[col] = None

    clean: list[dict] = []
    rejects: list[dict] = []
    seen: set[str] = set()
    for i, row in raw.iterrows():
        payload = row.to_dict()
        try:
            rec = WorkRecord(**payload)
            if rec.work_id in seen:
                raise ValueError("duplicate work_id inside upload batch")
            seen.add(rec.work_id)
            d = rec.model_dump()
            d["sanction_date"] = rec.sanction_date.isoformat()
            d["completion_date"] = rec.completion_date.isoformat() if rec.completion_date else None
            d["fiscal_year"] = rec.fiscal_year or _fiscal_year(rec.sanction_date)
            clean.append(d)
        except (ValidationError, ValueError) as exc:
            reasons = (
                "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
                if isinstance(exc, ValidationError)
                else str(exc)
            )
            rejects.append(
                {
                    "row_index": int(i),
                    "work_id": str(payload.get("work_id")),
                    "error_reason": reasons,
                    "raw_row": json.loads(pd.Series(payload).to_json()),
                    "rejected_at": datetime.utcnow().isoformat(timespec="seconds"),
                }
            )
    return pd.DataFrame(clean), rejects


# ---------------------------------------------------------------------------
# SQLite helpers
# ---------------------------------------------------------------------------
def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS works (
            work_id TEXT PRIMARY KEY, mp_id TEXT, mp_name TEXT, state TEXT, district TEXT,
            block TEXT, work_category TEXT, work_description TEXT, sanctioned_amount REAL,
            released_amount REAL, vendor_id TEXT, vendor_name TEXT, sanction_date TEXT,
            completion_date TEXT, status TEXT, fiscal_year TEXT, implementing_agency TEXT,
            geotag_uploaded INTEGER
        )
        """
    )
    conn.commit()


def load_works() -> pd.DataFrame:
    if not os.path.exists(DB_PATH):
        raise HTTPException(status_code=404, detail=f"Ledger store not found at {DB_PATH}. Run generate_mplads.py or POST /ingest.")
    conn = get_conn()
    try:
        ensure_schema(conn)
        df = pd.read_sql_query("SELECT * FROM works", conn)
    finally:
        conn.close()
    if df.empty:
        raise HTTPException(status_code=404, detail="Ledger store is empty. POST /ingest first.")
    return df


def upsert_works(df: pd.DataFrame) -> int:
    conn = get_conn()
    try:
        ensure_schema(conn)
        cols = REQUIRED_COLUMNS
        records = df[cols].astype(object).where(pd.notnull(df[cols]), None).values.tolist()
        conn.executemany(
            f"INSERT OR REPLACE INTO works ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
            records,
        )
        conn.commit()
        return len(records)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Forensic module: Puppeteer Synchrony Test (PST)
# ---------------------------------------------------------------------------
# Null hypothesis, per MP office: conditional on the set of D calendar days on
# which that office filed ANY paperwork, the assignment of vendors to filing
# days is exchangeable. For vendors A (active on a days) and B (active on b
# days) the number of shared days K is then Hypergeometric(D, a, b), and
# P(K >= k) is the exact one-sided tail. Two independent channels (sanction
# dates, completion dates) are fused with Fisher's method; BH-FDR is applied
# across all pairs nationally; significant pairs are chained into rings.
PST_MIN_ACTIVE_DAYS = 4        # vendor must have >=4 distinct filing days in the MP office
PST_MIN_SHARED_DAYS = 3        # pair must share >=3 days before it is even tested
PST_FDR = 0.01                 # Benjamini-Hochberg false-discovery ceiling
PST_MIN_RING = 2               # connected component size to be called a ring
PST_RING_STEP = 5              # extra penalty per additional puppet beyond two
PST_RING_CAP = 60              # ceiling on the R13 weight

_PAIR_COLS = ["v_a", "v_b", "shared_days", "days_a", "days_b", "calendar_days", "p"]


def _bh_qvalues(p: np.ndarray) -> np.ndarray:
    """Benjamini-Hochberg step-up q-values, vectorised."""
    n = len(p)
    if n == 0:
        return p
    order = np.argsort(p)
    ranked = p[order] * n / np.arange(1, n + 1)
    q = np.minimum.accumulate(ranked[::-1])[::-1]
    out = np.empty(n)
    out[order] = np.clip(q, 0.0, 1.0)
    return out


def _synchrony_channel(sub: pd.DataFrame, date_col: str) -> pd.DataFrame:
    """Vectorised pairwise hypergeometric co-filing test for ONE MP office and
    ONE date channel. Builds a sparse vendor x filing-day incidence matrix M,
    obtains all pairwise overlaps as M @ M.T, and evaluates the exact tail."""
    from scipy import sparse
    from scipy.stats import hypergeom

    x = sub.loc[sub["vendor_id"].notna() & sub[date_col].notna(), ["vendor_id", date_col]]
    if x.empty:
        return pd.DataFrame(columns=_PAIR_COLS)
    x = x.assign(day=x[date_col].dt.normalize()).drop_duplicates(["vendor_id", "day"])

    v_codes, vendors = pd.factorize(x["vendor_id"])
    d_codes, days = pd.factorize(x["day"])
    calendar_days = len(days)
    M = sparse.csr_matrix(
        (np.ones(len(x), dtype=np.int32), (v_codes, d_codes)),
        shape=(len(vendors), calendar_days),
    )
    active = np.asarray(M.sum(axis=1)).ravel()
    keep = np.flatnonzero(active >= PST_MIN_ACTIVE_DAYS)
    if len(keep) < 2:
        return pd.DataFrame(columns=_PAIR_COLS)

    M, active, vendors = M[keep], active[keep], np.asarray(vendors)[keep]
    K = (M @ M.T).toarray()
    iu, ju = np.triu_indices(len(keep), k=1)
    k = K[iu, ju]
    tested = k >= PST_MIN_SHARED_DAYS
    iu, ju, k = iu[tested], ju[tested], k[tested]
    if len(k) == 0:
        return pd.DataFrame(columns=_PAIR_COLS)

    a, b = active[iu], active[ju]
    # scipy hypergeom(M=population, n=successes, N=draws); P(K >= k) = sf(k - 1)
    p = hypergeom.sf(k - 1, calendar_days, a, b)
    return pd.DataFrame({
        "v_a": vendors[iu], "v_b": vendors[ju], "shared_days": k.astype(int),
        "days_a": a.astype(int), "days_b": b.astype(int),
        "calendar_days": calendar_days, "p": np.clip(p, 1e-300, 1.0),
    })


def puppeteer_synchrony(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Core PST analytic. Expects the _prepare()'d frame (sanction_dt, completion_dt).

    Returns
    -------
    pairs : one row per tested vendor pair within an MP office
            [mp_id, v_a, v_b, shared_sanction_days, shared_completion_days,
             calendar_days, p_sanction, p_completion, p_fisher, q, synchrony, is_ring]
    rings : one row per (mp_id, vendor_id) that belongs to a puppet ring
            [mp_id, vendor_id, ring_id, ring_size, ring_strength, ring_shared_days]
    """
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    from scipy.stats import chi2

    pair_cols = ["mp_id", "v_a", "v_b", "shared_sanction_days", "shared_completion_days",
                 "calendar_days", "p_sanction", "p_completion", "p_fisher", "q", "synchrony", "is_ring"]
    ring_cols = ["mp_id", "vendor_id", "ring_id", "ring_size", "ring_strength", "ring_shared_days"]

    frames = []
    for mp_id, sub in df.groupby("mp_id", sort=False):
        ps = _synchrony_channel(sub, "sanction_dt")
        if ps.empty:
            continue
        pc = _synchrony_channel(sub, "completion_dt")[["v_a", "v_b", "shared_days", "p"]]
        pairs = ps.rename(columns={"shared_days": "shared_sanction_days", "p": "p_sanction"}).merge(
            pc.rename(columns={"shared_days": "shared_completion_days", "p": "p_completion"}),
            on=["v_a", "v_b"], how="left",
        )
        pairs["p_completion"] = pairs["p_completion"].fillna(1.0)
        pairs["shared_completion_days"] = pairs["shared_completion_days"].fillna(0).astype(int)
        pairs.insert(0, "mp_id", mp_id)
        frames.append(pairs)

    if not frames:
        return pd.DataFrame(columns=pair_cols), pd.DataFrame(columns=ring_cols)

    pairs = pd.concat(frames, ignore_index=True)
    # Fisher's method: -2 * sum(ln p) ~ chi2 with 2 * (#channels) = 4 dof under H0
    fisher_stat = -2.0 * np.log(pairs[["p_sanction", "p_completion"]].values).sum(axis=1)
    pairs["p_fisher"] = np.clip(chi2.sf(fisher_stat, df=4), 1e-300, 1.0)
    pairs["q"] = _bh_qvalues(pairs["p_fisher"].values)
    pairs["synchrony"] = -np.log10(pairs["p_fisher"])
    pairs["is_ring"] = pairs["q"] < PST_FDR

    sig = pairs[pairs["is_ring"]]
    if sig.empty:
        return pairs[pair_cols], pd.DataFrame(columns=ring_cols)

    # Ring resolution: connected components over (mp_id, vendor_id) nodes
    node_a = sig["mp_id"] + "\x1f" + sig["v_a"]
    node_b = sig["mp_id"] + "\x1f" + sig["v_b"]
    codes, nodes = pd.factorize(pd.concat([node_a, node_b], ignore_index=True))
    n_nodes, n_edges = len(nodes), len(sig)
    adj = coo_matrix((np.ones(n_edges), (codes[:n_edges], codes[n_edges:])), shape=(n_nodes, n_nodes))
    _, labels = connected_components(adj, directed=False)

    rings = pd.DataFrame({"node": nodes, "comp": labels})
    rings[["mp_id", "vendor_id"]] = rings["node"].str.split("\x1f", n=1, expand=True)
    rings["ring_size"] = rings.groupby("comp")["vendor_id"].transform("size")
    rings = rings[rings["ring_size"] >= PST_MIN_RING].copy()

    edge_comp = pd.Series(labels[codes[:n_edges]], index=sig.index)
    comp_strength = sig.groupby(edge_comp)["synchrony"].max()
    comp_shared = sig.groupby(edge_comp)["shared_sanction_days"].max()
    rings["ring_strength"] = rings["comp"].map(comp_strength).round(2)
    rings["ring_shared_days"] = rings["comp"].map(comp_shared).astype(int)
    rings["ring_seq"] = rings.groupby("mp_id")["comp"].transform(lambda s: pd.factorize(s)[0] + 1)
    rings["ring_id"] = "RING-" + rings["mp_id"].astype(str) + "-" + rings["ring_seq"].map("{:02d}".format)
    return pairs[pair_cols], rings[ring_cols].reset_index(drop=True)


def puppeteer_dossier(scored: pd.DataFrame) -> pd.DataFrame:
    """Ring-level summary for auditors: puppets, outlay, share of MP purse, categories spanned."""
    if "ring_id" not in scored.columns or scored["ring_id"].isna().all():
        return pd.DataFrame(columns=["ring_id", "mp_id", "mp_name", "puppets", "works", "outlay_cr",
                                     "share_of_mp_outlay", "categories", "ring_strength", "vendors"])
    mp_total = scored.groupby("mp_id")["sanctioned_amount"].transform("sum")
    r = scored[scored["ring_id"].notna()].assign(mp_total=mp_total)
    g = r.groupby(["ring_id", "mp_id", "mp_name"])
    out = g.agg(
        puppets=("vendor_id", "nunique"),
        works=("work_id", "size"),
        outlay_cr=("sanctioned_amount", lambda s: round(float(s.sum()) / 100, 2)),
        categories=("work_category", "nunique"),
        ring_strength=("ring_strength", "max"),
        vendors=("vendor_name", lambda s: " | ".join(sorted(set(s.dropna())))),
    ).reset_index()
    share = r.groupby("ring_id")["sanctioned_amount"].sum() / r.groupby("ring_id")["mp_total"].first()
    out["share_of_mp_outlay"] = out["ring_id"].map(share).round(3)
    return out.sort_values("ring_strength", ascending=False).reset_index(drop=True)

# ---------------------------------------------------------------------------
# Rule engine
# ---------------------------------------------------------------------------
def _prepare(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["sanction_dt"] = pd.to_datetime(df["sanction_date"], errors="coerce")
    df["completion_dt"] = pd.to_datetime(df["completion_date"], errors="coerce")
    df["sanctioned_amount"] = pd.to_numeric(df["sanctioned_amount"], errors="coerce")
    df["released_amount"] = pd.to_numeric(df["released_amount"], errors="coerce")
    audit_ts = pd.Timestamp(AUDIT_DATE)
    df["sanction_age_days"] = (audit_ts - df["sanction_dt"]).dt.days
    df["duration_days"] = (df["completion_dt"] - df["sanction_dt"]).dt.days
    df["fiscal_year"] = df["fiscal_year"].fillna(df["sanction_dt"].dt.date.map(lambda d: _fiscal_year(d) if pd.notnull(d) else None))
    return df
# ---------------------------------------------------------------------------
# Forensics: EXIF geofence, Benford, cartel graph
# ---------------------------------------------------------------------------
EXIF_GEOFENCE_KM = 2.0
BENFORD_EXPECTED = np.log10(1 + 1 / np.arange(1, 10))
BENFORD_MIN_N = 50


def haversine_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 6371.0088 * 2 * np.arcsin(np.sqrt(a))


def validate_exif_geofence(df: pd.DataFrame, tolerance_km: float = EXIF_GEOFENCE_KM) -> pd.DataFrame:
    """Feature 1. Vectorised photo-submission audit.
    Returns df with `photo_distance_km` and `exif_flags` in
    {METADATA_TAMPERED, GEO_MISMATCH}."""
    out = df.copy()
    for c in KYC_COLUMNS:
        if c not in out.columns:
            out[c] = 0 if c == "photo_metadata_stripped" else np.nan
    geo_cols = ["official_project_latitude", "official_project_longitude", "photo_latitude", "photo_longitude"]
    for c in geo_cols:
        out[c] = pd.to_numeric(out[c], errors="coerce")
    stripped = pd.to_numeric(out["photo_metadata_stripped"], errors="coerce").fillna(0).astype(int).eq(1)
    has_geo = out[geo_cols].notna().all(axis=1)
    with np.errstate(invalid="ignore"):
        out["photo_distance_km"] = np.where(has_geo, haversine_km(*(out[c].values for c in geo_cols)), np.nan)
    mismatch = has_geo & (out["photo_distance_km"] > tolerance_km)
    out["exif_flags"] = [
        (["METADATA_TAMPERED"] if s else []) + (["GEO_MISMATCH"] if m else [])
        for s, m in zip(stripped, mismatch)
    ]
    return out


def benford_analysis(amounts: pd.Series, min_n: int = BENFORD_MIN_N) -> dict:
    """Feature 2. First-digit test vs P(d)=log10(1+1/d); chi-square GoF (8 dof)
    plus Nigrini MAD conformity band. flag=True when p < 0.05."""
    vals = pd.to_numeric(pd.Series(amounts), errors="coerce").dropna()
    vals = vals[vals > 0]
    digits = vals.map(lambda x: int(f"{x:.6e}"[0]))          # sci-notation -> leading digit, scale invariant
    obs = digits.value_counts().reindex(range(1, 10), fill_value=0).values.astype(float)
    n = int(obs.sum())
    base = {"n": n, "expected_pct": (BENFORD_EXPECTED * 100).round(2).tolist()}
    if n < min_n:
        return {**base, "observed_pct": [0.0] * 9, "chi_square": None, "p_value": None, "mad": None,
                "conformity": "INSUFFICIENT_N", "flag": False}
    chi2, p = chisquare(obs, BENFORD_EXPECTED * n)
    mad = float(np.mean(np.abs(obs / n - BENFORD_EXPECTED)))
    conformity = ("CLOSE" if mad < 0.006 else "ACCEPTABLE" if mad < 0.012
                  else "MARGINAL" if mad < 0.015 else "NONCONFORMITY")
    return {**base, "observed_pct": (obs / n * 100).round(2).tolist(), "chi_square": round(float(chi2), 3),
            "p_value": round(float(p), 6), "mad": round(mad, 4), "conformity": conformity, "flag": bool(p < 0.05)}


def benford_by_entity(df: pd.DataFrame, key: str = "mp_id", min_n: int = 60) -> pd.DataFrame:
    rows = []
    for ent, grp in df.groupby(key):
        r = benford_analysis(grp["sanctioned_amount"], min_n=min_n)
        if r["p_value"] is not None:
            rows.append({key: ent, "n": r["n"], "chi_square": r["chi_square"], "p_value": r["p_value"],
                         "mad": r["mad"], "conformity": r["conformity"], "flag": r["flag"]})
    df_rows = pd.DataFrame(rows)
    if not rows:
        return pd.DataFrame(columns=[key, "n", "chi_square", "p_value", "mad", "conformity", "flag"])
    return pd.DataFrame(rows).sort_values("p_value").reset_index(drop=True)
    


def _kyc_master(df: pd.DataFrame) -> pd.DataFrame:
    return (df[df["vendor_id"].notna()]
            [["vendor_id", "vendor_name", "state", "pan_card", "bank_account_number", "director_name"]]
            .drop_duplicates("vendor_id"))


def detect_cartels(df: pd.DataFrame) -> dict[str, str]:
    """Connected components over vendor<->KYC-attribute bipartite graph.
    Returns {vendor_id: cartel_id} for components containing >= 2 vendors."""
    G = nx.Graph()
    for r in _kyc_master(df).itertuples(index=False):
        G.add_node(r.vendor_id, kind="vendor")
        for kind, val in (("pan", r.pan_card), ("bank", r.bank_account_number), ("director", r.director_name)):
            if isinstance(val, str) and val:
                G.add_edge(r.vendor_id, f"{kind}:{val}")
    mapping, n = {}, 0
    for comp in nx.connected_components(G):
        vendors = [v for v in comp if G.nodes[v].get("kind") == "vendor"]
        if len(vendors) >= 2:
            n += 1
            mapping.update({v: f"CARTEL-{n:03d}" for v in vendors})
    return mapping


def build_cartel_graph(df: pd.DataFrame, out_html: str, cartel_only: bool = False) -> tuple[str, dict]:
    """Feature 3. Interactive pyvis network. Nodes: vendors, directors, banks, PANs.
    Shared attributes and their edges are drawn in vivid red."""
    from pyvis.network import Network

    kyc = _kyc_master(df)
    cartels = detect_cartels(df)
    outlay = df.groupby("vendor_id")["sanctioned_amount"].sum()
    attr_count = Counter(
        f"{k}:{v}" for r in kyc.itertuples(index=False)
        for k, v in (("pan", r.pan_card), ("bank", r.bank_account_number), ("director", r.director_name))
        if isinstance(v, str) and v
    )
    RED, GREY = "#dc2626", "#cbd5e1"
    palette = {"vendor": "#1d4ed8", "pan": "#0f766e", "bank": "#b45309", "director": "#6d28d9"}
    shapes = {"pan": "square", "bank": "diamond", "director": "triangle"}

    net = Network(height="640px", width="100%", bgcolor="#ffffff", font_color="#1f2937")
    net.barnes_hut(gravity=-12000, spring_length=140, spring_strength=0.02)
    for r in kyc.itertuples(index=False):
        in_cartel = r.vendor_id in cartels
        if cartel_only and not in_cartel:
            continue
        amt = float(outlay.get(r.vendor_id, 0.0))
        net.add_node(r.vendor_id, label=r.vendor_name, shape="dot", size=10 + min(30, amt / 50),
                     color=RED if in_cartel else palette["vendor"],
                     title=f"{r.vendor_id} | {r.state} | ₹{amt / 100:.2f} Cr | {cartels.get(r.vendor_id, 'no linkage')}")
        for kind, val in (("pan", r.pan_card), ("bank", r.bank_account_number), ("director", r.director_name)):
            if not (isinstance(val, str) and val):
                continue
            nid = f"{kind}:{val}"
            shared = attr_count[nid] > 1
            label = val if kind == "director" else f"{val[:4]}…{val[-4:]}"     # mask identifiers on screen
            net.add_node(nid, label=label, shape=shapes[kind], size=8 + 4 * shared,
                         color=RED if shared else palette[kind], title=f"{kind.upper()} shared by {attr_count[nid]} vendor(s)")
            net.add_edge(r.vendor_id, nid, color=RED if shared else GREY, width=3 if shared else 1)

    with open(out_html, "w", encoding="utf-8") as fh:
        fh.write(net.generate_html(notebook=False))
    cartel_vids = set(cartels)
    summary = {
        "cartels": len(set(cartels.values())),
        "cartel_vendors": len(cartel_vids),
        "cartel_outlay_cr": round(float(outlay.reindex(cartel_vids).sum() / 100), 2),
        "cartel_works": int(df["vendor_id"].isin(cartel_vids).sum()),
        "members": cartels,
    }
    return out_html, summary


def apply_rules(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, list[str]]]:
    """Returns (df with engineered columns, {work_id: [reason strings]})."""
    df = _prepare(df)
    reasons: dict[str, list[str]] = {w: [] for w in df["work_id"]}
    hits: dict[str, set[str]] = {w: set() for w in df["work_id"]}
    weights: dict[str, dict[str, int]] = {w: {} for w in df["work_id"]}

    def flag(mask: pd.Series, code: str, text_fn, weight_fn=None) -> None:
        for _, r in df[mask.fillna(False)].iterrows():
            if code not in hits[r["work_id"]]:
                hits[r["work_id"]].add(code)
                reasons[r["work_id"]].append(f"{code}|{text_fn(r)}")
                weights[r["work_id"]][code] = weight_fn(r) if weight_fn else RULE_WEIGHTS[code]

    audit_ts = pd.Timestamp(AUDIT_DATE)

    # R04 Impossible accounting — evaluate first, negative values poison ratios
    neg = (df["sanctioned_amount"] < 0) | (df["released_amount"] < 0)
    flag(neg, "R04", lambda r: f"Negative amount (sanc ₹{r['sanctioned_amount']:.2f}L / rel ₹{r['released_amount']:.2f}L)")

    # R01 Over-release
    over = (~neg) & (df["released_amount"] > df["sanctioned_amount"])
    df["release_ratio"] = np.where(df["sanctioned_amount"] > 0, df["released_amount"] / df["sanctioned_amount"], 0.0)
    flag(over, "R01", lambda r: f"Released {r['release_ratio'] * 100:.0f}% of sanction (₹{r['released_amount'] - r['sanctioned_amount']:.2f}L excess)")

    # R02 Annual cap breach (MP × FY)
    mp_fy = df.groupby(["mp_id", "fiscal_year"])["sanctioned_amount"].transform("sum")
    df["mp_fy_outlay"] = mp_fy
    flag(mp_fy > ANNUAL_CAP_LAKHS, "R02", lambda r: f"MP FY outlay ₹{r['mp_fy_outlay'] / 100:.2f}Cr > ₹5Cr cap")

    # R03 Cost benchmark anomaly (state × category median)
    med = df.groupby(["state", "work_category"])["sanctioned_amount"].transform("median")
    df["category_median"] = med
    df["cost_multiple"] = np.where(med > 0, df["sanctioned_amount"] / med, 1.0)
    flag(df["cost_multiple"] > COST_MULTIPLIER, "R03", lambda r: f"Cost {r['cost_multiple']:.1f}x state-category median")

    # R05 Speed fraud
    speed = (df["status"] == "Completed") & (df["duration_days"] < SPEED_DAYS)
    flag(speed, "R05", lambda r: f"Completed in {int(r['duration_days'])} day(s) (<{SPEED_DAYS}d)")

    # R06 Stale stagnation
    stale = (df["status"] == "In Progress") & (df["sanction_age_days"] > STALE_DAYS)
    flag(stale, "R06", lambda r: f"In Progress for {int(r['sanction_age_days'])} days, past 12-month limit")

    # R07 Future dating
    future = (df["sanction_dt"] > audit_ts) | (df["completion_dt"] > audit_ts)
    flag(future, "R07", lambda r: "Sanction/completion date is after audit date")

    # R08 Vendor dominance — share of MP FY outlay, or >8 consecutive contracts
    vend_outlay = df.groupby(["mp_id", "fiscal_year", "vendor_id"])["sanctioned_amount"].transform("sum")
    df["vendor_share_mp_fy"] = np.where(mp_fy > 0, vend_outlay / mp_fy, 0.0)
    df.loc[df["vendor_id"].isna(), "vendor_share_mp_fy"] = 0.0
    flag(df["vendor_share_mp_fy"] > VENDOR_SHARE, "R08", lambda r: f"Vendor {r['vendor_id']} holds {r['vendor_share_mp_fy'] * 100:.0f}% of MP FY outlay")

    consecutive_ids: set[str] = set()
    for _, grp in df.sort_values("sanction_dt").groupby("mp_id"):
        run: list[str] = []
        prev_vendor = None
        for _, r in grp.iterrows():
            v = r["vendor_id"]
            if v is not None and v == prev_vendor:
                run.append(r["work_id"])
            else:
                if len(run) > VENDOR_CONSECUTIVE:
                    consecutive_ids.update(run)
                run = [r["work_id"]]
                prev_vendor = v
        if len(run) > VENDOR_CONSECUTIVE:
            consecutive_ids.update(run)
    flag(df["work_id"].isin(consecutive_ids), "R08", lambda r: f">{VENDOR_CONSECUTIVE} consecutive contracts to vendor {r['vendor_id']}")

    # R09 Micro-splitting — same MP, same vendor, same date, ≥3 sanctions each < threshold
    small = df[(df["sanctioned_amount"] < MICRO_SPLIT_THRESHOLD) & df["vendor_id"].notna()]
    grp_cnt = small.groupby(["mp_id", "vendor_id", "sanction_date"])["work_id"].transform("count")
    split_ids = set(small.loc[grp_cnt >= MICRO_SPLIT_MIN_COUNT, "work_id"])
    df["micro_split_count"] = 0
    df.loc[df["work_id"].isin(split_ids), "micro_split_count"] = df.loc[df["work_id"].isin(split_ids)].groupby(["mp_id", "vendor_id", "sanction_date"])["work_id"].transform("count")
    flag(df["work_id"].isin(split_ids), "R09", lambda r: f"{int(r['micro_split_count'])} sub-threshold sanctions to same vendor on {r['sanction_date']}")

    # R10 Duplicate text — rapidfuzz token_set_ratio > 85 within same MP, category and block.
    # Two-tier: a text hit is CONFIRMED (full weight) when corroborated by near-identical
    # sanction amount (±15%), sanction dates within 180 days and a high character-level
    # ratio; otherwise it is a "similar text" REVIEW hit (low weight). This is what keeps
    # two legitimate bore wells in the same block from being called ghost works.
    df["dup_ratio"] = 0.0
    df["dup_char_ratio"] = 0.0
    df["dup_match_id"] = None
    df["dup_confirmed"] = False
    dup_cols = ["mp_id", "work_category", "block"]
    wid_index = pd.Series(df.index, index=df["work_id"])
    for _, grp in df[df["block"].notna() & df["work_category"].notna()].groupby(dup_cols):
        if len(grp) < 2:
            continue
        ids = grp["work_id"].tolist()
        descs = grp["work_description"].fillna("").tolist()
        amts = grp["sanctioned_amount"].values
        dts = grp["sanction_dt"].values
        matrix = process.cdist(descs, descs, scorer=fuzz.token_set_ratio, dtype=np.uint8)
        np.fill_diagonal(matrix, 0)
        best = matrix.max(axis=1)
        best_idx = matrix.argmax(axis=1)
        for k, wid in enumerate(ids):
            if best[k] > DUP_RATIO:
                j = int(best_idx[k])
                char_ratio = fuzz.ratio(descs[k], descs[j])
                amt_gap = abs(amts[k] - amts[j]) / max(amts[k], amts[j], 1e-9)
                day_gap = abs((dts[k] - dts[j]) / np.timedelta64(1, "D")) if not (pd.isna(dts[k]) or pd.isna(dts[j])) else 9999
                confirmed = bool(char_ratio > DUP_CHAR_RATIO and amt_gap <= DUP_AMOUNT_GAP and day_gap <= DUP_DAY_GAP)
                df.loc[wid_index[wid], ["dup_ratio", "dup_char_ratio", "dup_match_id", "dup_confirmed"]] = [
                    float(best[k]), float(char_ratio), ids[j], confirmed,
                ]
    flag(
        df["dup_ratio"] > DUP_RATIO,
        "R10",
        lambda r: (
            f"{r['dup_ratio']:.0f}% text match with {r['dup_match_id']} — amount & date corroborated (confirmed duplicate)"
            if r["dup_confirmed"]
            else f"{r['dup_ratio']:.0f}% text match with {r['dup_match_id']} — no amount/date corroboration (review only)"
        ),
        lambda r: RULE_WEIGHTS["R10"] if r["dup_confirmed"] else RULE_WEIGHT_R10_REVIEW,
    )

    # R11 Abandoned works
    abandoned = (df["status"] == "Sanctioned") & (df["released_amount"] <= 0) & (df["sanction_age_days"] > ABANDON_DAYS)
    flag(abandoned, "R11", lambda r: f"Zero release {int(r['sanction_age_days'])} days after sanction")

    # R12 Missing mandatory metadata
    missing_meta = df["block"].isna() | df["vendor_id"].isna() | df["work_category"].isna()
    flag(missing_meta, "R12", lambda r: "Null in block / vendor / category")
    # R13/R14 Forensic EXIF & geofence
    exif = validate_exif_geofence(df)
    df["photo_distance_km"] = exif["photo_distance_km"].values
    df["exif_flags"] = exif["exif_flags"].values
    flag(df["exif_flags"].map(lambda f: "METADATA_TAMPERED" in f), "R13", lambda r: "Completion photo EXIF stripped (no timestamp/GPS)")
    flag(df["exif_flags"].map(lambda f: "GEO_MISMATCH" in f), "R14", lambda r: f"Photo geotag {r['photo_distance_km']:.1f} km from sanctioned site (>{EXIF_GEOFENCE_KM} km)")

    # R15 Cartel linkage — shared PAN / bank / director across distinct vendor IDs
    df["cartel_id"] = df["vendor_id"].map(detect_cartels(df))
    flag(df["cartel_id"].notna(), "R15", lambda r: f"Vendor {r['vendor_id']} shares KYC identifiers with {r['cartel_id']}")
        # R16 Puppeteer synchrony — vendors whose filing calendars are phase-locked
    _, rings = puppeteer_synchrony(df)
    key = pd.MultiIndex.from_frame(df[["mp_id", "vendor_id"]])
    if rings.empty:
        df["ring_id"], df["ring_size"], df["ring_strength"], df["ring_shared_days"] = None, 0, 0.0, 0
    else:
        lookup = rings.set_index(["mp_id", "vendor_id"])
        df["ring_id"] = lookup["ring_id"].reindex(key).values
        df["ring_size"] = lookup["ring_size"].reindex(key).fillna(0).astype(int).values
        df["ring_strength"] = lookup["ring_strength"].reindex(key).fillna(0.0).values
        df["ring_shared_days"] = lookup["ring_shared_days"].reindex(key).fillna(0).astype(int).values
    flag(
        df["ring_id"].notna(),
        "R16",
        lambda r: (
            f"Vendor {r['vendor_id']} phase-locked with {int(r['ring_size']) - 1} other firm(s) in {r['ring_id']} — "
            f"{int(r['ring_shared_days'])} shared filing days, synchrony 10^-{r['ring_strength']:.1f}"
        ),
        lambda r: min(PST_RING_CAP, RULE_WEIGHTS["R16"] + PST_RING_STEP * (int(r["ring_size"]) - 2)),
    )

    df["rule_codes"] = df["work_id"].map(lambda w: sorted(hits[w]))
    df["rule_penalty"] = df["work_id"].map(lambda w: min(100, sum(weights[w].values())))
    return df, reasons


# ---------------------------------------------------------------------------
# ML: Isolation Forest
# ---------------------------------------------------------------------------
def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    grp = df.groupby(["state", "work_category"])["sanctioned_amount"]
    mean = grp.transform("mean")
    std = grp.transform("std").replace(0, np.nan)
    feats = pd.DataFrame(index=df.index)
    feats["cost_zscore_category"] = ((df["sanctioned_amount"] - mean) / std).fillna(0.0)
    feats["duration_days"] = df["duration_days"].fillna(df["sanction_age_days"].clip(lower=0)).fillna(0.0)
    feats["vendor_expenditure_share"] = df["vendor_share_mp_fy"].fillna(0.0)
    feats["release_ratio"] = df["release_ratio"].fillna(0.0).clip(-2, 3)
    feats["log_sanctioned"] = np.log1p(df["sanctioned_amount"].clip(lower=0).fillna(0.0))
    return feats.replace([np.inf, -np.inf], 0.0).fillna(0.0)


def isolation_forest_scores(feats: pd.DataFrame) -> np.ndarray:
    """Returns 0–100 anomaly percentile (100 = most anomalous)."""
    model = IsolationForest(n_estimators=200, contamination=IF_CONTAMINATION, random_state=SEED, n_jobs=-1)
    model.fit(feats.values)
    raw = -model.score_samples(feats.values)  # higher = more anomalous
    ranks = pd.Series(raw).rank(pct=True).values
    return np.round(ranks * 100, 2)


# ---------------------------------------------------------------------------
# Composite scoring
# ---------------------------------------------------------------------------
def tier_for(score: float) -> str:
    if score > 80:
        return "CRITICAL"
    if score > 60:
        return "HIGH"
    if score > 40:
        return "MEDIUM"
    return "LOW"


def compute_risk(rule_penalty: np.ndarray, if_score: np.ndarray) -> np.ndarray:
    """
    Rules dominate (deterministic, explainable). The Isolation Forest can
    corroborate and lift a rule-backed record, but a single ML-only signal is
    demoted to 'review' (capped at 45) — never 'fraud' without a rule hit.
    """
    corroborated = np.minimum(100.0, rule_penalty + 0.25 * if_score)
    # ML-only: 0.4 x percentile (max 40 = LOW) — only the top ~5% most anomalous
    # (percentile >= 95) climb into the 40-45 'review' band.
    ml_only = np.minimum(45.0, 0.4 * if_score + np.maximum(0.0, if_score - 95.0))
    return np.round(np.where(rule_penalty > 0, corroborated, ml_only), 1)


def run_engine(df: Optional[pd.DataFrame] = None) -> pd.DataFrame:
    """Full pipeline: rules -> features -> IsolationForest -> composite risk register."""
    if df is None:
        df = load_works()
    scored, reasons = apply_rules(df)
    feats = engineer_features(scored)
    scored["if_score"] = isolation_forest_scores(feats)
    scored["cost_zscore_category"] = feats["cost_zscore_category"].values
    scored["risk_score"] = compute_risk(scored["rule_penalty"].values.astype(float), scored["if_score"].values)
    scored["risk_tier"] = scored["risk_score"].map(tier_for)
    scored["triggered_rules"] = scored["rule_codes"]
    scored["reasons"] = scored["work_id"].map(lambda w: [r.split("|", 1)[1] for r in reasons[w]])
    scored["reason_labels"] = scored["rule_codes"].map(lambda codes: [RULE_LABELS[c] for c in codes])
    scored["reason_chips"] = scored.apply(_chips, axis=1)
    scored["exposure_lakhs"] = np.where(
        scored["risk_score"] > 60,
        np.maximum(scored["released_amount"], scored["sanctioned_amount"]),
        0.0,
    )
    return scored.sort_values(["risk_score", "sanctioned_amount"], ascending=[False, False]).reset_index(drop=True)


def _chips(r: pd.Series) -> list[str]:
    chips: list[str] = []
    for code in r["rule_codes"]:
        if code == "R05":
            chips.append(f"Speed Fraud ({int(r['duration_days'])}d)")
        elif code == "R03":
            chips.append(f"Cost {r['cost_multiple']:.1f}x Median")
        elif code == "R10":
            chips.append(
                f"Duplicate Work {r['dup_ratio']:.0f}% Match"
                if r["dup_confirmed"]
                else f"Similar Text {r['dup_ratio']:.0f}% (review)"
            )
        elif code == "R01":
            chips.append(f"Over-Release {r['release_ratio'] * 100:.0f}%")
        elif code == "R08":
            chips.append(f"Vendor {r['vendor_share_mp_fy'] * 100:.0f}% Share" if r["vendor_share_mp_fy"] > VENDOR_SHARE else "Vendor Consecutive Run")
        elif code == "R02":
            chips.append(f"Cap Breach ₹{r['mp_fy_outlay'] / 100:.1f}Cr")
        elif code == "R06":
            chips.append(f"Stale {int(r['sanction_age_days'])}d")
        elif code == "R11":
            chips.append(f"Abandoned {int(r['sanction_age_days'])}d")
        elif code == "R14":
            chips.append(f"Geo Mismatch {r['photo_distance_km']:.0f} km")
        elif code == "R15":
            chips.append(f"Cartel {r['cartel_id']}")
        elif code == "R16":
            chips.append(f"Puppet Ring ×{int(r['ring_size'])} ({int(r['ring_shared_days'])}d lock-step)")
        else:
            chips.append(RULE_LABELS[code])
    if not chips and r["if_score"] >= 90:
        chips.append(f"ML Outlier p{int(r['if_score'])}")
    return chips


def register_records(scored: pd.DataFrame) -> list[dict]:
    out = []
    for _, r in scored.iterrows():
        out.append(
            {
                "work_id": r.get("work_id"),
                "risk_score": float(r.get("risk_score", 0)),
                "risk_tier": r.get("risk_tier"),
                "triggered_rules": list(r.get("triggered_rules", [])),
                "reason_chips": list(r.get("reason_chips", [])),
                "reasons": list(r.get("reasons", [])),
                "if_score": float(r.get("if_score", 0)),
                "mp_id": r.get("mp_id"),
                "mp_name": r.get("mp_name"),
                "state": r.get("state"),
                "district": r.get("district"),
                "block": r.get("block"),
                "work_category": r.get("work_category"),
                "work_description": r.get("work_description"),
                "vendor_id": r.get("vendor_id"),
                "vendor_name": r.get("vendor_name"),
                "sanctioned_amount": float(r.get("sanctioned_amount", 0)),
                "released_amount": float(r.get("released_amount", 0)),
                "sanction_date": r.get("sanction_date"),
                "completion_date": r.get("completion_date"),
                "status": r.get("status"),
                "fiscal_year": r.get("fiscal_year"),
                "exif_flags": list(r["exif_flags"]) if "exif_flags" in r else [],
                "photo_distance_km": r.get("photo_distance_km"),
                "cartel_id": r.get("cartel_id"),
                "ring_id": r.get("ring_id")
            }
        )
    return out


def compute_stats(scored: pd.DataFrame) -> dict:
    tiers = scored["risk_tier"].value_counts().to_dict()
    by_state = (
        scored.groupby("state")
        .agg(
            avg_risk=("risk_score", "mean"),
            works=("work_id", "count"),
            high_risk=("risk_score", lambda s: int((s > 60).sum())),
            funds_cr=("sanctioned_amount", lambda s: float(s.sum() / 100)),
            exposure_cr=("exposure_lakhs", lambda s: float(s.sum() / 100)),
        )
        .reset_index()
    )
    by_state["avg_risk"] = by_state["avg_risk"].round(2)
    rule_freq = pd.Series([c for codes in scored["rule_codes"] for c in codes]).value_counts()
    cartels = detect_cartels(scored)
    return {
        "audit_date": AUDIT_DATE.isoformat(),
        "cartel_count": len(set(cartels.values())),
        "total_funds_monitored_cr": round(float(scored["sanctioned_amount"].sum() / 100), 2),
        "total_released_cr": round(float(scored["released_amount"].sum() / 100), 2),
        "total_sanctions": int(len(scored)),
        "mps": int(scored["mp_id"].nunique()),
        "states": int(scored["state"].nunique()),
        "vendors": int(scored["vendor_id"].nunique()),
        "high_risk_flags": int((scored["risk_score"] > 60).sum()),
        "critical_flags": int((scored["risk_score"] > 80).sum()),
        "review_queue": int((scored["risk_score"] > 40).sum()),
        "potential_leakage_prevented_cr": round(float(scored["exposure_lakhs"].sum() / 100), 2),
        "tier_counts": {t: int(tiers.get(t, 0)) for t in ["CRITICAL", "HIGH", "MEDIUM", "LOW"]},
        "rule_frequency": [{"code": c, "label": RULE_LABELS[c], "count": int(n)} for c, n in rule_freq.items()],
        "by_state": by_state.to_dict(orient="records"),
        "status_counts": scored["status"].value_counts().to_dict(),
        "category_counts": scored["work_category"].fillna("Unknown").value_counts().to_dict(),
    }


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="MPLADS-Sentinel Integrity Engine",
    description="AI-powered public fund integrity engine for e-SAKSHI MPLADS ledgers (SIH26102, MoSPI).",
    version="1.0.0",
)

from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://mplads-sentinel-sih.netlify.app"
 "https://mplads-sentinel-sih.netlify.app/"
],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

QUARANTINE_REJECTS: list[dict] = []
_CACHE: dict[str, Any] = {"scored": None, "row_count": -1}


def _clean(obj: Any) -> Any:
    """Recursively convert numpy/pandas scalars and NaN/NaT into JSON-safe values."""
    if isinstance(obj, dict):
        return {str(k): _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_clean(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        return None if np.isnan(obj) or np.isinf(obj) else float(obj)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (pd.Timestamp, datetime, date)):
        return obj.isoformat()
    if obj is pd.NaT:
        return None
    return obj


def _json(payload: Any) -> JSONResponse:
    return JSONResponse(content=_clean(payload))


def _scored_cached() -> pd.DataFrame:
    df = load_works()
    if _CACHE["scored"] is None or _CACHE["row_count"] != len(df):
        _CACHE["scored"] = run_engine(df)
        _CACHE["row_count"] = len(df)
    return _CACHE["scored"]


def _invalidate() -> None:
    _CACHE["scored"] = None
    _CACHE["row_count"] = -1


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "db": DB_PATH, "db_exists": os.path.exists(DB_PATH), "audit_date": AUDIT_DATE.isoformat()}


def _ingest_frame(raw: pd.DataFrame) -> dict:
    if raw.empty:
        raise HTTPException(status_code=400, detail="Upload contains no rows.")
    clean, rejects = validate_frame(raw)
    QUARANTINE_REJECTS.extend(rejects)
    written = upsert_works(clean) if not clean.empty else 0
    _invalidate()
    return {
        "received": int(len(raw)),
        "accepted": int(written),
        "quarantined": int(len(rejects)),
        "quarantine_total": len(QUARANTINE_REJECTS),
        "sample_rejects": rejects[:5],
    }


@app.get("/quarantine")
def quarantine(limit: int = Query(default=200, ge=1, le=5000)) -> dict:
    return {"count": len(QUARANTINE_REJECTS), "rejects": QUARANTINE_REJECTS[-limit:]}


@app.get("/score")
def score(
    min_score: float = Query(default=0.0, ge=0, le=100),
    tier: Optional[str] = Query(default=None, pattern="^(LOW|MEDIUM|HIGH|CRITICAL)$"),
    state: Optional[str] = None,
    limit: int = Query(default=5000, ge=1, le=50000),
) -> JSONResponse:
    scored = _scored_cached()
    view = scored[scored["risk_score"] >= min_score]
    if tier:
        view = view[view["risk_tier"] == tier]
    if state:
        view = view[view["state"] == state]
    payload = {
        "audit_date": AUDIT_DATE.isoformat(),
        "count": int(len(view)),
        "register": register_records(view.head(limit)),
    }
    return _json(payload)


@app.get("/stats")
def stats() -> JSONResponse:
    return _json(compute_stats(_scored_cached()))


@app.get("/mp/{mp_id}")
def mp_portfolio(mp_id: str) -> JSONResponse:
    scored = _scored_cached()
    port = scored[scored["mp_id"] == mp_id]
    if port.empty:
        raise HTTPException(status_code=404, detail=f"No works found for {mp_id}")
    vendors = (
        port.groupby(["vendor_id", "vendor_name"], dropna=False)["sanctioned_amount"]
        .sum()
        .reset_index()
        .sort_values("sanctioned_amount", ascending=False)
    )
    vendors["share"] = (vendors["sanctioned_amount"] / port["sanctioned_amount"].sum()).round(4)
    fy = port.groupby("fiscal_year")["sanctioned_amount"].sum().round(2).to_dict()
    timeline = port.groupby(port["sanction_dt"].dt.to_period("M").astype(str))["sanctioned_amount"].agg(["count", "sum"]).reset_index()
    timeline.columns = ["month", "sanctions", "amount_lakhs"]
    payload = {
        "mp_id": mp_id,
        "mp_name": port["mp_name"].iloc[0],
        "state": port["state"].iloc[0],
        "district": port["district"].iloc[0],
        "works": int(len(port)),
        "total_sanctioned_cr": round(float(port["sanctioned_amount"].sum() / 100), 2),
        "total_released_cr": round(float(port["released_amount"].sum() / 100), 2),
        "avg_risk": round(float(port["risk_score"].mean()), 2),
        "high_risk_works": int((port["risk_score"] > 60).sum()),
        "fy_outlay_lakhs": fy,
        "cap_breaches": [k for k, v in fy.items() if v > ANNUAL_CAP_LAKHS],
        "vendor_concentration": vendors.to_dict(orient="records"),
        "timeline": timeline.to_dict(orient="records"),
        "tier_counts": port["risk_tier"].value_counts().to_dict(),
        "register": register_records(port),
    }
    return _json(payload)
@app.get("/forensics/benford")
def benford(group_by: Optional[str] = Query(default=None, pattern="^(mp_id|vendor_id|state)$")) -> JSONResponse:
    scored = _scored_cached()
    if group_by:
        return _json(benford_by_entity(scored, group_by).to_dict(orient="records"))
    return _json(benford_analysis(scored["sanctioned_amount"]))


@app.get("/forensics/cartel")
def cartel(cartel_only: bool = False) -> JSONResponse:
    path, summary = build_cartel_graph(_scored_cached(), os.path.join(BASE_DIR, "cartel_network.html"), cartel_only)
    return _json({**summary, "html_path": path})


@app.get("/forensics/cartel/html")
def cartel_html() -> JSONResponse:
    """Serve the generated Pyvis network HTML for iframe embedding."""
    html_path = os.path.join(BASE_DIR, "cartel_network.html")
    # Ensure the graph is built first
    if not os.path.exists(html_path):
        build_cartel_graph(_scored_cached(), html_path, cartel_only=False)
    with open(html_path, "r", encoding="utf-8") as fh:
        html_content = fh.read()
    return JSONResponse(content={"html": html_content})


@app.get("/forensics/exif")
def exif_audit(limit: int = Query(default=500, ge=1, le=5000)) -> JSONResponse:
    scored = _scored_cached()
    view = scored[scored["exif_flags"].map(len) > 0]
    return _json({"count": int(len(view)), "register": register_records(view.head(limit))})


@app.get("/explain/{work_id}")
def explain(work_id: str) -> JSONResponse:
    from api.narrative import executive_brief
    scored = _scored_cached()
    hit = scored[scored["work_id"] == work_id]
    if hit.empty:
        raise HTTPException(status_code=404, detail=f"{work_id} not in register")
    return _json({"work_id": work_id, "briefing": executive_brief(register_records(hit)[0])})
@app.get("/forensics/puppeteer")
def puppeteer(mp_id: Optional[str] = None) -> JSONResponse:
    scored = _scored_cached()
    pairs, rings = puppeteer_synchrony(scored)
    all_dossier = puppeteer_dossier(scored)
    
    # List of all MPs with detected rings for dropdown
    mp_list = all_dossier.drop_duplicates("mp_id")[["mp_id", "mp_name"]].to_dict(orient="records") if not all_dossier.empty else []
    
    # Default to all (National Overview) if no mp_id specified
    target_mp = mp_id if mp_id else "all"
        
    if target_mp and target_mp != "all":
        scoped_pairs = pairs[pairs["mp_id"] == target_mp]
        scoped_rings = rings[rings["mp_id"] == target_mp]
        scoped_df = scored[scored["mp_id"] == target_mp]
    else:
        scoped_pairs = pairs
        scoped_rings = rings
        scoped_df = scored
        
    # Build vendor name lookup from full scored dataframe
    vendor_names = scored[scored["vendor_id"].notna()].drop_duplicates("vendor_id").set_index("vendor_id")["vendor_name"].to_dict()
    
    # Enrich significant pairs with vendor names
    sig_pairs = scoped_pairs[scoped_pairs["is_ring"]].sort_values("synchrony", ascending=False).head(200).copy()
    if not sig_pairs.empty:
        sig_pairs["vendor_name_a"] = sig_pairs["v_a"].map(vendor_names).fillna(sig_pairs["v_a"])
        sig_pairs["vendor_name_b"] = sig_pairs["v_b"].map(vendor_names).fillna(sig_pairs["v_b"])
    
    # Build timeline works (sanctions with dates and vendor info)
    ring_of = rings.set_index("vendor_id")["ring_id"].to_dict() if not rings.empty else {}
    timeline_df = scoped_df[scoped_df["vendor_id"].notna() & scoped_df["sanction_date"].notna()].copy()
    if target_mp == "all" and not timeline_df.empty:
        ring_vids = set(rings["vendor_id"].dropna().unique())
        timeline_df = timeline_df[timeline_df["vendor_id"].isin(ring_vids) | (timeline_df["risk_score"] > 50)].head(150)
    timeline_works = []
    if not timeline_df.empty:
        timeline_df = timeline_df.sort_values("sanction_date")
        for _, r in timeline_df.iterrows():
            vid = r["vendor_id"]
            r_id = ring_of.get(vid)
            timeline_works.append({
                "work_id": str(r.get("work_id", "")),
                "sanction_date": str(r.get("sanction_date", ""))[:10],
                "vendor_id": str(vid),
                "vendor_name": str(r.get("vendor_name") or vid),
                "ring_id": str(r_id) if r_id else None,
                "is_ring": bool(r_id),
                "ring_category": "Ring" if r_id else "Independent",
                "sanctioned_amount": float(r.get("sanctioned_amount", 0)),
            })
            
    return _json({
        "selected_mp": target_mp,
        "mp_list": mp_list,
        "pairs_tested": int(len(scoped_pairs)),
        "pairs_significant": int(scoped_pairs["is_ring"].sum()) if len(scoped_pairs) else 0,
        "rings": puppeteer_dossier(scoped_df).to_dict(orient="records"),
        "all_rings": all_dossier.to_dict(orient="records"),
        "significant_pairs": sig_pairs.to_dict(orient="records"),
        "vendor_names": vendor_names,
        "timeline_works": timeline_works,
    })


@app.get("/search/mp")
def search_mp(q: str = Query(default=""), limit: int = Query(default=1000, ge=1, le=5000)) -> JSONResponse:
    """Fuzzy search MPs by name. Returns all matches up to limit."""
    scored = _scored_cached()
    unique_mps = scored.drop_duplicates("mp_id")[["mp_id", "mp_name", "state", "district"]].sort_values("mp_name").reset_index(drop=True)
    if not q.strip() or q == "__all__":
        return _json(unique_mps.head(limit).to_dict(orient="records"))
    matches = process.extract(q, unique_mps["mp_name"].tolist(), scorer=fuzz.WRatio, limit=limit)
    indices = [unique_mps[unique_mps["mp_name"] == m[0]].index[0] for m in matches if m[1] > 35]
    return _json(unique_mps.iloc[indices].to_dict(orient="records"))


@app.get("/search/vendor")
def search_vendor(q: str = Query(default=""), limit: int = Query(default=2000, ge=1, le=10000)) -> JSONResponse:
    """Fuzzy search vendors by name. Returns all matches up to limit."""
    scored = _scored_cached()
    unique_vendors = scored[scored["vendor_id"].notna()].drop_duplicates("vendor_id")[["vendor_id", "vendor_name", "state"]].sort_values("vendor_name").reset_index(drop=True)
    if not q.strip() or q == "__all__":
        return _json(unique_vendors.head(limit).to_dict(orient="records"))
    matches = process.extract(q, unique_vendors["vendor_name"].tolist(), scorer=fuzz.WRatio, limit=limit)
    indices = [unique_vendors[unique_vendors["vendor_name"] == m[0]].index[0] for m in matches if m[1] > 35]
    return _json(unique_vendors.iloc[indices].to_dict(orient="records"))


@app.get("/ground-truth")
def ground_truth() -> JSONResponse:
    """Returns precision/recall/F1 vs ground truth if available."""
    scored = _scored_cached()
    if not os.path.exists(GT_PATH):
        return _json({"available": False})
    gt_df = pd.read_csv(GT_PATH)
    merged = scored.merge(gt_df, on="work_id", how="inner")
    pred_fraud = merged["risk_score"] >= 50
    actual_fraud = merged["is_fraud"] == 1
    tp = int((pred_fraud & actual_fraud).sum())
    fp = int((pred_fraud & ~actual_fraud).sum())
    fn = int((~pred_fraud & actual_fraud).sum())
    tn = int((~pred_fraud & ~actual_fraud).sum())
    precision = (tp / (tp + fp)) * 100 if (tp + fp) > 0 else 0
    recall = (tp / (tp + fn)) * 100 if (tp + fn) > 0 else 0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0
    return _json({
        "available": True,
        "precision": round(precision, 1),
        "recall": round(recall, 1),
        "f1": round(f1, 1),
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "true_negatives": tn,
        "total_matched": int(len(merged)),
    })


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api.main:app", host="0.0.0.0", port=8000, reload=False)


"""
MPLADS-Sentinel | Phase 1: Enterprise Data Generator
Produces a deterministic 5,000-row synthetic e-SAKSHI ledger with 5 injected
CAG-audited fraud archetypes.

Outputs (written next to this file):
    mplads.db          -> SQLite, table `works` (no fraud labels)
    ground_truth.csv   -> work_id, is_fraud, fraud_type (offline validation only)

Usage:
    python generate_mplads.py
"""

from __future__ import annotations

import csv
import math
import os
import random
import sqlite3
from datetime import date, timedelta

import numpy as np
import pandas as pd
from faker import Faker

SEED = 42
N_RECORDS = 5_000
FRAUD_RATE = 0.05  # 5% -> ~250 labelled records

random.seed(SEED)
np.random.seed(SEED)
Faker.seed(SEED)
fake = Faker("en_IN")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "mplads.db")
GT_PATH = os.path.join(BASE_DIR, "ground_truth.csv")

# ---------------------------------------------------------------------------
# Geographic hierarchy: State -> {code, districts -> blocks}
# ---------------------------------------------------------------------------
GEO: dict[str, dict] = {
    "Assam": {
        "code": "AS",
        "districts": {
            "Kamrup Metropolitan": ["Dispur", "Chandrapur", "Sonapur", "Dimoria"],
            "Dibrugarh": ["Barbaruah", "Lahowal", "Tengakhat", "Khowang"],
            "Jorhat": ["Titabor", "Teok", "Mariani", "Kaliapani"],
            "Nagaon": ["Kathiatoli", "Raha", "Dhing", "Batadrava"],
            "Barpeta": ["Bajali", "Chenga", "Sarthebari", "Mandia"],
        },
    },
    "Maharashtra": {
        "code": "MH",
        "districts": {
            "Pune": ["Haveli", "Mulshi", "Baramati", "Junnar"],
            "Nagpur": ["Kamptee", "Hingna", "Katol", "Saoner"],
            "Nashik": ["Sinnar", "Niphad", "Malegaon", "Igatpuri"],
            "Aurangabad": ["Paithan", "Gangapur", "Sillod", "Vaijapur"],
            "Solapur": ["Barshi", "Pandharpur", "Akkalkot", "Madha"],
        },
    },
    "Uttar Pradesh": {
        "code": "UP",
        "districts": {
            "Lucknow": ["Mohanlalganj", "Malihabad", "Bakshi Ka Talab", "Sarojini Nagar"],
            "Varanasi": ["Pindra", "Arajiline", "Sevapuri", "Cholapur"],
            "Gorakhpur": ["Campierganj", "Chargawan", "Pipraich", "Sahjanwa"],
            "Kanpur Nagar": ["Bilhaur", "Ghatampur", "Kalyanpur", "Sarsaul"],
            "Prayagraj": ["Soraon", "Phulpur", "Karchana", "Meja"],
        },
    },
    "Bihar": {
        "code": "BR",
        "districts": {
            "Patna": ["Danapur", "Phulwari", "Bihta", "Masaurhi"],
            "Gaya": ["Bodh Gaya", "Manpur", "Sherghati", "Tekari"],
            "Muzaffarpur": ["Kanti", "Minapur", "Sakra", "Bochaha"],
            "Bhagalpur": ["Nathnagar", "Sabour", "Kahalgaon", "Sultanganj"],
            "Darbhanga": ["Bahadurpur", "Benipur", "Jale", "Keoti"],
        },
    },
    "Rajasthan": {
        "code": "RJ",
        "districts": {
            "Jaipur": ["Sanganer", "Amber", "Chomu", "Bassi"],
            "Jodhpur": ["Luni", "Osian", "Bilara", "Phalodi"],
            "Udaipur": ["Girwa", "Mavli", "Vallabhnagar", "Salumbar"],
            "Kota": ["Ladpura", "Sangod", "Itawa", "Sultanpur"],
        },
    },
    "Tamil Nadu": {
        "code": "TN",
        "districts": {
            "Chennai": ["Egmore", "Mylapore", "Perambur", "Tondiarpet"],
            "Coimbatore": ["Pollachi", "Sulur", "Annur", "Madukkarai"],
            "Madurai": ["Melur", "Usilampatti", "Thirumangalam", "Vadipatti"],
            "Salem": ["Attur", "Omalur", "Mettur", "Sankari"],
        },
    },
}

# Authentic constituency-style MP names (synthetic individuals).
MP_ROSTER: dict[str, list[str]] = {
    "Assam": [
        "Shri Pradyut Bordoloi", "Smt. Queen Oja", "Shri Rameswar Teli",
        "Shri Topon Kumar Gogoi", "Shri Abdul Khaleque", "Shri Dilip Saikia",
        "Shri Gaurav Gogoi", "Smt. Bijuli Kalita Medhi", "Shri Rakibul Hussain",
        "Shri Kamakhya Prasad Tasa",
    ],
    "Maharashtra": [
        "Shri Girish Bapat", "Shri Nitin Gadkari", "Shri Hemant Godse",
        "Shri Imtiaz Jaleel", "Dr. Jaisiddheshwar Swami", "Smt. Supriya Sule",
        "Shri Rajan Vichare", "Shri Bhaskar Bhagare", "Shri Sanjay Jadhav",
        "Shri Shrirang Barne",
    ],
    "Uttar Pradesh": [
        "Shri Rajnath Singh", "Shri Narendra Modi", "Shri Ravi Kishan",
        "Shri Satyadev Pachauri", "Smt. Keshari Devi Patel", "Shri Ramesh Awasthi",
        "Shri Ujjwal Raman Singh", "Shri Rajeev Rai", "Smt. Anupriya Patel",
        "Shri Awadhesh Prasad",
    ],
    "Bihar": [
        "Shri Ram Kripal Yadav", "Shri Vijay Kumar", "Shri Ajay Nishad",
        "Shri Ajay Kumar Mandal", "Shri Gopal Jee Thakur", "Shri Ravi Shankar Prasad",
        "Shri Jitan Ram Manjhi", "Shri Raj Bhushan Choudhary", "Shri Sudhakar Singh",
        "Shri Sanjay Jaiswal",
    ],
    "Rajasthan": [
        "Shri Ramcharan Bohra", "Shri Gajendra Singh Shekhawat",
        "Shri Arjunlal Meena", "Shri Om Birla", "Shri Manju Sharma",
        "Shri Rao Rajendra Singh", "Shri Mannalal Rawat", "Shri Ummeda Ram Beniwal",
        "Shri C.P. Joshi", "Shri Bhajan Lal Jatav",
    ],
    "Tamil Nadu": [
        "Shri Dayanidhi Maran", "Shri P.R. Natarajan",
        "Shri Su. Venkatesan", "Shri S.R. Parthiban", "Shri Ganapathy Rajkumar",
        "Shri T.R. Baalu", "Shri Kalanidhi Veeraswamy", "Smt. Kanimozhi Karunanidhi",
        "Shri A. Raja", "Shri Sasikanth Senthil",
    ],
}

CATEGORIES = [
    "Drinking Water",
    "Education Infrastructure",
    "Roads & Bridges",
    "Public Health",
    "Sanitation",
]

# Log-normal centre per category (₹ Lakhs). Overall mass sits between 5L and 40L.
CATEGORY_MEDIAN_LAKHS = {
    "Drinking Water": 9.0,
    "Education Infrastructure": 14.0,
    "Roads & Bridges": 22.0,
    "Public Health": 12.0,
    "Sanitation": 7.0,
}

# Templates carry three variable slots so two legitimate works of the same type in
# the same block still differ in specification ({qty}), facility ({name}) and locality ({loc}),
# mirroring real e-SAKSHI descriptions. A1 duplicates paraphrase the FULL description.
WORK_TEMPLATES = {
    "Drinking Water": [
        "Installation of {qty} deep bore wells with India Mark-II hand pumps near {name} at {loc}",
        "Construction of {qty} L capacity overhead water tank with pump house at {name}, {loc}",
        "Laying of {qty} m HDPE pipeline for piped drinking water supply from {name} to {loc}",
        "Installation of {qty} LPH solar powered RO water purification unit at {name}, {loc}",
        "Renovation of community well and construction of {qty} m platform at {name}, {loc}",
        "Provision of {qty} water ATMs with chilling unit at {name}, {loc}",
    ],
    "Education Infrastructure": [
        "Construction of {qty} additional classrooms at {name} Govt. Primary School, {loc}",
        "Construction of {qty} m boundary wall with gate for {name} Govt. High School, {loc}",
        "Setting up computer laboratory with {qty} systems at {name} Govt. Higher Secondary School, {loc}",
        "Construction of library building ({qty} sq ft) at {name} Govt. Middle School, {loc}",
        "Construction of {qty} seat toilet block for girls at {name} Govt. School, {loc}",
        "Supply of {qty} sets of dual desks and smart boards to {name} Govt. School, {loc}",
    ],
    "Roads & Bridges": [
        "Construction of {qty} m CC road from {name} main road to {loc}",
        "Construction of RCC culvert ({qty} m span) on approach road near {name}, {loc}",
        "Black topping of {qty} m link road connecting {name} to PWD road, {loc}",
        "Construction of {qty} m footbridge over drain near {name}, {loc}",
        "Construction of {qty} sq m interlocking paver block road at {name} lane, {loc}",
        "Construction of {qty} m RCC retaining wall along {name} road, {loc}",
    ],
    "Public Health": [
        "Construction of {qty} bed health sub-centre building at {name}, {loc}",
        "Supply of {qty} ambulances with basic life support to {name} Primary Health Centre, {loc}",
        "Construction of {qty} seat waiting shed at {name} Community Health Centre, {loc}",
        "Installation of {qty} units of diagnostic equipment at {name} PHC, {loc}",
        "Construction of {qty} staff quarters at {name} PHC, {loc}",
        "Construction of {qty} bed dialysis ward at {name} Hospital, {loc}",
    ],
    "Sanitation": [
        "Construction of {qty} seat community toilet complex near {name}, {loc}",
        "Construction of {qty} m covered drainage system along {name} road, {loc}",
        "Installation of {qty} solid waste collection bins and {name} composting shed at {loc}",
        "Construction of {qty} seat public urinal block near {name} market, {loc}",
        "Construction of {qty} soak pits and drains at {name} colony, {loc}",
        "Provision of {qty} e-rickshaw garbage collection vehicles for {name} ward, {loc}",
    ],
}

QTY_RANGES = {
    "Drinking Water": (2, 60),
    "Education Infrastructure": (2, 40),
    "Roads & Bridges": (120, 1800),
    "Public Health": (2, 30),
    "Sanitation": (4, 120),
}

FACILITY_NAMES = [
    "Netaji", "Rajiv Gandhi", "Dr. Ambedkar", "Bhagat Singh", "Indira", "Lal Bahadur",
    "Gopinath Bordoloi", "Shivaji", "Kalam", "Vivekananda", "Subhash", "Mahatma Gandhi",
    "Jyotiba Phule", "Sardar Patel", "Lachit", "Bharathiar", "Kamaraj", "Maharana Pratap",
    "Kabir", "Chandrashekhar Azad", "Birsa Munda", "Rani Laxmibai", "Tagore", "Sarojini",
]

# Paraphrase pairs for A1 duplicates: (original template, paraphrased duplicate)
PARAPHRASE = {
    "Construction of": ["Constructing", "Building of", "Const. of"],
    "Installation of": ["Installing", "Setting up of", "Instln. of"],
    "Laying of": ["Laying", "Provision of"],
    "Renovation of": ["Renovating", "Repair and renovation of"],
    "Setting up": ["Establishment of", "Setting-up of"],
    "Supply of": ["Procurement of", "Supply and delivery of"],
    "Black topping of": ["Bituminous surfacing of", "BT work on"],
}

STATUS_WEIGHTS = {"Completed": 0.55, "In Progress": 0.30, "Sanctioned": 0.15}

START_DATE = date(2023, 4, 1)
END_DATE = date(2026, 2, 28)
TODAY = date(2026, 3, 1)  # Frozen "current date" for reproducible demo runs

VENDOR_SUFFIXES = [
    "Constructions", "Infra Projects", "Builders", "Enterprises", "& Sons",
    "Engineering Works", "Contractors", "Infrastructure Pvt Ltd",
]
# ---------------------------------------------------------------------------
# KYC / geospatial audit layer
# ---------------------------------------------------------------------------
CARTEL_RATE = 0.15            # share of distinct vendor_ids bound into cartels
CARTEL_SIZE = (3, 5)
STRIP_RATE_CLEAN = 0.04       # honest contractors occasionally upload compressed photos
STRIP_RATE_FRAUD = 0.65
GEO_MISMATCH_RATE_FRAUD = 0.45
GEO_JITTER_KM = 0.35          # legitimate handheld GPS scatter

STATE_BBOX = {  # lat_min, lat_max, lon_min, lon_max
    "Assam": (24.2, 27.9, 89.7, 96.0),
    "Maharashtra": (15.6, 22.0, 72.7, 80.9),
    "Uttar Pradesh": (23.9, 30.4, 77.1, 84.6),
    "Bihar": (24.3, 27.5, 83.3, 88.3),
    "Rajasthan": (23.1, 30.2, 69.5, 78.3),
    "Tamil Nadu": (8.1, 13.6, 76.2, 80.3),
}
_ALPHA = "ABCDEFGHJKLMNPRSTUVWXYZ"


def _pan() -> str:
    # AAAAA9999A; 4th char = entity type (C company / F firm / P person / H HUF)
    return f"{''.join(random.choices(_ALPHA, k=3))}{random.choice('CFPH')}{random.choice(_ALPHA)}{random.randint(1000, 9999)}{random.choice(_ALPHA)}"


def _bank_acct() -> str:
    return f"{random.choice(['SBIN', 'HDFC', 'ICIC', 'PUNB', 'BARB', 'UBIN'])}{random.randint(10**10, 10**11 - 1)}"


def build_vendor_kyc(df: pd.DataFrame) -> pd.DataFrame:
    """One KYC row per vendor_id. ~15% of vendors are bound into same-state cartels
    (same state => they bid across overlapping constituencies) that share PAN,
    bank account and/or director across otherwise distinct vendor IDs."""
    vendors = (
        df[df["vendor_id"].notna()][["vendor_id", "state"]]
        .drop_duplicates("vendor_id")
        .reset_index(drop=True)
    )
    vendors["pan_card"] = [_pan() for _ in range(len(vendors))]
    vendors["bank_account_number"] = [_bank_acct() for _ in range(len(vendors))]
    vendors["director_name"] = [fake.name() for _ in range(len(vendors))]
    vendors["cartel_id"] = None

    total_quota = int(len(vendors) * CARTEL_RATE)
    cartel_no = 0
    for state, grp in vendors.groupby("state"):
        quota = round(total_quota * len(grp) / len(vendors))
        pool = grp.index.tolist()
        random.shuffle(pool)
        while quota >= CARTEL_SIZE[0] and len(pool) >= CARTEL_SIZE[0]:
            size = min(random.randint(*CARTEL_SIZE), quota, len(pool))
            members = [pool.pop() for _ in range(size)]
            cartel_no += 1
            shared = {"pan_card": _pan(), "bank_account_number": _bank_acct(), "director_name": fake.name()}
            # Vary the overlap so the graph shows PAN-only, bank-only and full cliques
            keys = random.sample(list(shared), k=random.choice([1, 2, 3]))
            for m in members:
                for k in keys:
                    vendors.loc[m, k] = shared[k]
                vendors.loc[m, "cartel_id"] = f"CARTEL-{GEO[state]['code']}-{cartel_no:02d}"
            quota -= size
    return vendors


def enrich_kyc_geo(df: pd.DataFrame, gt: pd.DataFrame) -> pd.DataFrame:
    """Attach vendor KYC, official site coordinates and simulated completion-photo
    EXIF metadata. Fraud-labelled works are biased toward stripped or off-site photos."""
    df = df.merge(build_vendor_kyc(df).drop(columns="state"), on="vendor_id", how="left")
    is_fraud = df["work_id"].isin(set(gt.loc[gt["is_fraud"] == 1, "work_id"])).values

    lat, lon, plat, plon, stripped = [], [], [], [], []
    for i, r in enumerate(df.itertuples(index=False)):
        a, b, c, d = STATE_BBOX[r.state]
        la, lo = round(random.uniform(a, b), 6), round(random.uniform(c, d), 6)
        lat.append(la)
        lon.append(lo)
        s = 1 if random.random() < (STRIP_RATE_FRAUD if is_fraud[i] else STRIP_RATE_CLEAN) else 0
        stripped.append(s)
        if s or r.status == "Sanctioned":          # no usable EXIF / no photo yet
            plat.append(None)
            plon.append(None)
            continue
        if is_fraud[i] and random.random() < GEO_MISMATCH_RATE_FRAUD:
            dk = random.uniform(8, 60)              # photo recycled from another site
        else:
            dk = abs(random.gauss(0, GEO_JITTER_KM))
        ang = random.uniform(0, 2 * math.pi)
        plat.append(round(la + dk * math.cos(ang) / 111.0, 6))
        plon.append(round(lo + dk * math.sin(ang) / (111.0 * math.cos(math.radians(la))), 6))

    df["official_project_latitude"] = lat
    df["official_project_longitude"] = lon
    df["photo_latitude"] = plat
    df["photo_longitude"] = plon
    df["photo_metadata_stripped"] = stripped
    return df

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _fiscal_year(d: date) -> str:
    return f"FY{d.year}-{str(d.year + 1)[-2:]}" if d.month >= 4 else f"FY{d.year - 1}-{str(d.year)[-2:]}"


def _rand_date(start: date, end: date) -> date:
    return start + timedelta(days=random.randint(0, (end - start).days))


def _lognormal_lakhs(category: str) -> float:
    median = CATEGORY_MEDIAN_LAKHS[category]
    sigma = 0.38  # 2.5x median sits ~2.4 sigma out -> rare for legitimate works
    value = float(np.random.lognormal(mean=math.log(median), sigma=sigma))
    return round(max(1.5, min(value, 95.0)), 2)


def _make_vendor_pool(state_code: str, n: int) -> list[tuple[str, str]]:
    pool = []
    for _ in range(n):
        year = random.choice([2023, 2024, 2025])
        vid = f"VND-{state_code}-{year}-{random.randint(1000, 9999):04d}"
        vname = f"{fake.last_name()} {random.choice(VENDOR_SUFFIXES)}"
        pool.append((vid, vname))
    return pool


def _paraphrase(desc: str) -> str:
    for key, alts in PARAPHRASE.items():
        if desc.startswith(key):
            desc = desc.replace(key, random.choice(alts), 1)
            break
    # Light lexical noise typical of manually re-keyed entries
    if random.random() < 0.5:
        desc = desc.replace("Govt.", "Government")
    if random.random() < 0.4:
        desc = desc.replace("road", "Road").replace("village", "Village")
    return desc


# ---------------------------------------------------------------------------
# Build MP master
# ---------------------------------------------------------------------------
def build_mps() -> list[dict]:
    mps = []
    idx = 1
    for state, names in MP_ROSTER.items():
        districts = list(GEO[state]["districts"].keys())
        for i, name in enumerate(names):
            district = districts[i % len(districts)]
            mps.append(
                {
                    "mp_id": f"MP-{GEO[state]['code']}-{idx:03d}",
                    "mp_name": name,
                    "state": state,
                    "district": district,
                    "constituency": district,
                }
            )
            idx += 1
    return mps


# ---------------------------------------------------------------------------
# Generate clean base ledger
# ---------------------------------------------------------------------------
def generate_base(mps: list[dict]) -> pd.DataFrame:
    vendor_pools = {s: _make_vendor_pool(GEO[s]["code"], 45) for s in GEO}
    rows = []
    for i in range(N_RECORDS):
        mp = random.choice(mps)
        state = mp["state"]
        district = mp["district"]
        block = random.choice(GEO[state]["districts"][district])
        category = random.choice(CATEGORIES)
        template = random.choice(WORK_TEMPLATES[category])
        locality = random.choice(
            [
                f"{fake.first_name()} Nagar, {block}",
                f"Ward No. {random.randint(1, 24)}, {block}",
                f"{fake.last_name()} Chowk, {block}",
                f"{fake.first_name()}pur village, {block}",
                f"{fake.last_name()} Colony, {block}",
            ]
        )
        lo, hi = QTY_RANGES[category]
        qty = random.randint(lo, hi)
        qty_txt = f"{qty * 1000:,}" if "{qty} L capacity" in template else str(qty)
        description = template.format(qty=qty_txt, name=random.choice(FACILITY_NAMES), loc=locality)

        sanction_date = _rand_date(START_DATE, END_DATE)
        age_days = (TODAY - sanction_date).days
        status = random.choices(list(STATUS_WEIGHTS), weights=list(STATUS_WEIGHTS.values()))[0]
        # Operational realism: works sanctioned long ago are overwhelmingly closed out.
        if status == "In Progress" and age_days > 365 and random.random() < 0.9:
            status = "Completed"
        if status == "Sanctioned" and age_days > 180 and random.random() < 0.85:
            status = "In Progress" if age_days <= 365 or random.random() < 0.3 else "Completed"
        if status == "Completed" and age_days < 60:
            status = "In Progress"
        sanctioned = _lognormal_lakhs(category)

        if status == "Completed":
            completion_date = sanction_date + timedelta(days=random.randint(60, min(365, max(60, age_days))))
        else:
            completion_date = None

        if status == "Completed":
            released = round(sanctioned * random.uniform(0.95, 1.0), 2)
        elif status == "In Progress":
            released = round(sanctioned * random.uniform(0.25, 0.75), 2)
        else:
            # Recently sanctioned: often zero release yet
            released = 0.0 if (TODAY - sanction_date).days < 180 or random.random() < 0.5 else round(
                sanctioned * random.uniform(0.1, 0.3), 2
            )

        vendor_id, vendor_name = random.choice(vendor_pools[state])

        rows.append(
            {
                "work_id": f"WRK-{GEO[state]['code']}-{i + 1:06d}",
                "mp_id": mp["mp_id"],
                "mp_name": mp["mp_name"],
                "state": state,
                "district": district,
                "block": block,
                "work_category": category,
                "work_description": description,
                "sanctioned_amount": sanctioned,  # ₹ Lakhs
                "released_amount": released,  # ₹ Lakhs
                "vendor_id": vendor_id,
                "vendor_name": vendor_name,
                "sanction_date": sanction_date.isoformat(),
                "completion_date": completion_date.isoformat() if completion_date else None,
                "status": status,
                "fiscal_year": _fiscal_year(sanction_date),
                "implementing_agency": random.choice(
                    ["PWD", "Zilla Parishad", "Block Development Office", "Jal Board", "Municipal Council"]
                ),
                "geotag_uploaded": 1 if status == "Completed" and random.random() < 0.9 else 0,
            }
        )
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Inject fraud archetypes
# ---------------------------------------------------------------------------
def inject_fraud(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    df = df.copy()
    n_fraud_target = int(N_RECORDS * FRAUD_RATE)
    labels: dict[str, str] = {}

    # Category-state medians on clean data (for A2 calibration)
    medians = df.groupby(["state", "work_category"])["sanctioned_amount"].median()

    available = set(df.index)

    def take(n: int) -> list[int]:
        chosen = random.sample(sorted(available), n)
        for c in chosen:
            available.discard(c)
        return chosen

    # Allocation across archetypes
    alloc = {
        "A1_DUPLICATE_WORK": int(n_fraud_target * 0.24),  # pairs -> both labelled
        "A2_COST_INFLATION": int(n_fraud_target * 0.22),
        "A3_OVER_RELEASE": int(n_fraud_target * 0.18),
        "A4_VENDOR_CONCENTRATION": int(n_fraud_target * 0.18),
        "A5_SPEED_FRAUD": int(n_fraud_target * 0.18),
    }

    # --- A1: Duplicate work (paraphrased description, same district/block) ----
    n_pairs = alloc["A1_DUPLICATE_WORK"] // 2
    for _ in range(n_pairs):
        src_idx, dup_idx = take(2)
        src = df.loc[src_idx]
        dup_desc = _paraphrase(src["work_description"])
        df.loc[dup_idx, ["mp_id", "mp_name", "state", "district", "block", "work_category"]] = (
            src[["mp_id", "mp_name", "state", "district", "block", "work_category"]].values
        )
        df.loc[dup_idx, "work_description"] = dup_desc
        df.loc[dup_idx, "sanctioned_amount"] = round(float(src["sanctioned_amount"]) * random.uniform(0.9, 1.1), 2)
        df.loc[dup_idx, "released_amount"] = round(float(df.loc[dup_idx, "sanctioned_amount"]) * random.uniform(0.5, 1.0), 2)
        new_sd = date.fromisoformat(src["sanction_date"]) + timedelta(days=random.randint(15, 120))
        new_sd = min(new_sd, END_DATE)
        df.loc[dup_idx, "sanction_date"] = new_sd.isoformat()
        df.loc[dup_idx, "fiscal_year"] = _fiscal_year(new_sd)
        df.loc[dup_idx, "status"] = "In Progress"
        df.loc[dup_idx, "completion_date"] = None
        df.loc[dup_idx, "work_id"] = f"WRK-{GEO[src['state']]['code']}-{dup_idx + 1:06d}"
        labels[df.loc[src_idx, "work_id"]] = "A1_DUPLICATE_WORK"
        labels[df.loc[dup_idx, "work_id"]] = "A1_DUPLICATE_WORK"

    # --- A2: Cost inflation (>2.5x state-category median) -------------------
    for idx in take(alloc["A2_COST_INFLATION"]):
        row = df.loc[idx]
        med = float(medians.loc[(row["state"], row["work_category"])])
        inflated = round(med * random.uniform(2.8, 4.5), 2)
        df.loc[idx, "sanctioned_amount"] = inflated
        if row["status"] == "Completed":
            df.loc[idx, "released_amount"] = round(inflated * random.uniform(0.95, 1.0), 2)
        elif row["status"] == "In Progress":
            df.loc[idx, "released_amount"] = round(inflated * random.uniform(0.3, 0.7), 2)
        labels[row["work_id"]] = "A2_COST_INFLATION"

    # --- A3: Over-release (released strictly > sanctioned) -------------------
    for idx in take(alloc["A3_OVER_RELEASE"]):
        row = df.loc[idx]
        df.loc[idx, "released_amount"] = round(float(row["sanctioned_amount"]) * random.uniform(1.08, 1.45), 2)
        labels[row["work_id"]] = "A3_OVER_RELEASE"

    # --- A4: Vendor concentration (>60% of MP annual outlay / >8 consecutive) -
    # Pick 3 MPs; funnel one vendor through a large share of their FY works.
    mp_ids = df["mp_id"].unique().tolist()
    target_mps = random.sample(mp_ids, 3)
    per_mp = max(1, alloc["A4_VENDOR_CONCENTRATION"] // len(target_mps))
    for mp_id in target_mps:
        fy = random.choice(["FY2024-25", "FY2025-26"])
        cand = [i for i in df.index[(df["mp_id"] == mp_id) & (df["fiscal_year"] == fy)] if i in available]
        if len(cand) < 6:
            cand = [i for i in df.index[df["mp_id"] == mp_id] if i in available]
        chosen = cand[: min(len(cand), max(per_mp, 9))]
        for c in chosen:
            available.discard(c)
        state = df.loc[chosen[0], "state"]
        dom_vid = f"VND-{GEO[state]['code']}-2024-{random.randint(1000, 9999):04d}"
        dom_vname = f"{fake.last_name()} Infra Projects"
        # Funnel: the dominant vendor's contracts are inflated so its share clearly
        # crosses 60% of the MP's FY outlay (classic capture pattern).
        for c in chosen:
            df.loc[c, ["vendor_id", "vendor_name"]] = [dom_vid, dom_vname]
            df.loc[c, "sanctioned_amount"] = round(float(df.loc[c, "sanctioned_amount"]) * random.uniform(2.0, 2.6), 2)
            if df.loc[c, "status"] == "Completed":
                df.loc[c, "released_amount"] = round(float(df.loc[c, "sanctioned_amount"]) * random.uniform(0.95, 1.0), 2)
            elif df.loc[c, "status"] == "In Progress":
                df.loc[c, "released_amount"] = round(float(df.loc[c, "sanctioned_amount"]) * random.uniform(0.3, 0.7), 2)
            labels[df.loc[c, "work_id"]] = "A4_VENDOR_CONCENTRATION"

    # --- A5: Speed fraud (Completed < 7 days after sanction) -----------------
    for idx in take(alloc["A5_SPEED_FRAUD"]):
        row = df.loc[idx]
        sd = date.fromisoformat(row["sanction_date"])
        cd = sd + timedelta(days=random.randint(0, 6))
        df.loc[idx, "status"] = "Completed"
        df.loc[idx, "completion_date"] = cd.isoformat()
        df.loc[idx, "released_amount"] = round(float(row["sanctioned_amount"]) * random.uniform(0.97, 1.0), 2)
        df.loc[idx, "geotag_uploaded"] = 0
        labels[row["work_id"]] = "A5_SPEED_FRAUD"

    # --- Realistic operational noise (NOT fraud, exercises ingestion gate) ---
    # ~0.6% missing metadata rows — labelled clean; engine should flag R12 only.
    for idx in take(int(N_RECORDS * 0.006)):
        col = random.choice(["block", "vendor_id", "work_category"])
        df.loc[idx, col] = None

    gt = pd.DataFrame(
        {
            "work_id": df["work_id"],
            "is_fraud": df["work_id"].map(lambda w: 1 if w in labels else 0),
            "fraud_type": df["work_id"].map(lambda w: labels.get(w, "NONE")),
        }
    )
    return df, gt
# ---> PASTE THE NEW FUNCTION RIGHT HERE <---
def inject_puppet_ring(df: pd.DataFrame, gt: pd.DataFrame, n_rings: int = 6, puppets: int = 4, days: int = 10) -> None:
    """Syndicate operator files for `puppets` shell firms on the same `days` filing dates and
    back-fills their completion certificates together. Mutates df/gt in place."""
    import random
    from datetime import timedelta
    for mp in random.sample(sorted(df["mp_id"].unique()), n_rings):
        pool = df.index[(df["mp_id"] == mp) & (df["status"] == "Completed")].tolist()
        if len(pool) < puppets * days:
            continue
        rows = random.sample(pool, puppets * days)
        filing = sorted(fake.date_between(start_date="-3y", end_date="-8M") for _ in range(days))
        vids = [f"VND-{mp[-4:]}-P{i}" for i in range(puppets)]
        for j, ix in enumerate(rows):
            d = filing[j % days]
            df.loc[ix, ["vendor_id", "vendor_name"]] = vids[j // days], f"{fake.last_name()} {random.choice(VENDOR_SUFFIXES)}"
            
            # FIXED: Added .isoformat() to convert the raw Date objects into text strings
            df.loc[ix, "sanction_date"] = d.isoformat()
            df.loc[ix, "completion_date"] = (d + timedelta(days=random.choice([120, 150, 180]))).isoformat()
            
        gt.loc[gt["work_id"].isin(df.loc[rows, "work_id"]), ["is_fraud", "fraud_type"]] = 1, "PUPPET_RING"


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------
def write_outputs(df: pd.DataFrame, gt: pd.DataFrame) -> None:
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE works (
            work_id             TEXT PRIMARY KEY,
            mp_id               TEXT,
            mp_name             TEXT,
            state               TEXT,
            district            TEXT,
            block               TEXT,
            work_category       TEXT,
            work_description    TEXT,
            sanctioned_amount   REAL,
            released_amount     REAL,
            vendor_id           TEXT,
            vendor_name         TEXT,
            sanction_date       TEXT,
            completion_date     TEXT,
            status              TEXT,
            fiscal_year         TEXT,
            implementing_agency TEXT,
            geotag_uploaded     INTEGER,
            pan_card                   TEXT,
            bank_account_number        TEXT,
            director_name              TEXT,
            official_project_latitude  REAL,
            official_project_longitude REAL,
            photo_latitude             REAL,
            photo_longitude            REAL,
            photo_metadata_stripped    INTEGER
        )
        """
    )
    cur.execute("CREATE INDEX idx_works_mp ON works(mp_id)")
    cur.execute("CREATE INDEX idx_works_state ON works(state)")
    cur.execute("CREATE INDEX idx_works_vendor ON works(vendor_id)")
    cur.execute("CREATE INDEX idx_works_pan ON works(pan_card)")
    conn.commit()

    cols = [
        "work_id", "mp_id", "mp_name", "state", "district", "block", "work_category",
        "work_description", "sanctioned_amount", "released_amount", "vendor_id",
        "vendor_name", "sanction_date", "completion_date", "status", "fiscal_year",
        "implementing_agency", "geotag_uploaded","pan_card", "bank_account_number", "director_name",
        "official_project_latitude", "official_project_longitude",
        "photo_latitude", "photo_longitude", "photo_metadata_stripped",
    ]
    records = df[cols].astype(object).where(pd.notnull(df[cols]), None).values.tolist()
    cur.executemany(f"INSERT INTO works ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", records)
    conn.commit()
    conn.close()

    gt.to_csv(GT_PATH, index=False, quoting=csv.QUOTE_MINIMAL)


def main() -> None:
    mps = build_mps()
    base = generate_base(mps)
    # Generate base fraud (Micro-splitting, Dominance, etc.)
    ledger, gt = inject_fraud(base)
    
    # NEW: Inject the synchronized date patterns for the Puppeteer test
    inject_puppet_ring(ledger, gt)
    
    # ENRICH: Add fake PAN cards, coordinates, and cartel assignments
    ledger = enrich_kyc_geo(ledger, gt)
    
    # MAP: Update ground truth with the new cartel IDs
    gt["cartel_id"] = gt["work_id"].map(ledger.set_index("work_id")["cartel_id"]).fillna("NONE")
    
    # SHUFFLE: Randomize the final dataset so the dashboard reads it naturally
    ledger = ledger.sample(frac=1.0, random_state=SEED).reset_index(drop=True)  # shuffle
    write_outputs(ledger, gt)

    total_cr = ledger["sanctioned_amount"].sum() / 100
    print(f"[generate_mplads] rows={len(ledger)} mps={ledger['mp_id'].nunique()} states={ledger['state'].nunique()}")
    print(f"[generate_mplads] total sanctioned = ₹{total_cr:,.2f} Cr")
    print(f"[generate_mplads] fraud labels = {int(gt['is_fraud'].sum())} ({gt['is_fraud'].mean():.2%})")
    print(gt[gt["is_fraud"] == 1]["fraud_type"].value_counts().to_string())
    print(f"[generate_mplads] wrote {DB_PATH}")
    print(f"[generate_mplads] wrote {GT_PATH}")
    print(f"[generate_mplads] cartel vendors = {ledger.loc[ledger['cartel_id'].notna(), 'vendor_id'].nunique()}")


if __name__ == "__main__":
    main()

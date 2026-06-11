from flask import Flask, render_template, request, jsonify
import requests
import os

app = Flask(__name__)

OPENFDA_BASE = "https://api.fda.gov/drug/event.json"


def fda_get(search=None, count=None, limit=1):
    """
    Build URL manually so AND/range syntax is NOT percent-encoded by requests.
    """
    url = OPENFDA_BASE + "?"
    parts = []
    if search:
        parts.append("search=" + search)
    if count:
        parts.append("count=" + count)
    parts.append("limit=" + str(limit))
    url += "&".join(parts)

    try:
        r = requests.get(url, timeout=12)
        if r.status_code == 404:
            return {"meta": {"results": {"total": 0}}, "results": []}
        r.raise_for_status()
        return r.json()
    except Exception as e:
        return {"error": str(e), "meta": {"results": {"total": 0}}, "results": []}


def safe_total(data):
    return data.get("meta", {}).get("results", {}).get("total", 0)


def build_drug_search(drug):
    """Correct OpenFDA search string for a drug name."""
    return f'patient.drug.medicinalproduct:"{drug}"'


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/overview")
def overview():
    # Total reports (all)
    total_data = fda_get(limit=1)
    total_reports = safe_total(total_data)

    # Severe count: serious=1 means serious adverse event
    severe_data = fda_get(search="serious:1", limit=1)
    severe_count = safe_total(severe_data)
    severe_pct = round(severe_count / total_reports * 100, 1) if total_reports else 0

    # Top 10 drugs by report count
    top_drugs_data = fda_get(count="patient.drug.medicinalproduct.exact", limit=10)
    top_drugs = []
    if "results" in top_drugs_data:
        top_drugs = [{"drug": r["term"], "count": r["count"]}
                     for r in top_drugs_data["results"][:10]]

    # Severity distribution (count by serious field: 1=serious, 2=not serious)
    sev_data = fda_get(count="serious", limit=5)
    sev_map = {"1": "Serious", "2": "Not Serious"}
    severity_dist = []
    if "results" in sev_data:
        for r in sev_data["results"]:
            severity_dist.append({
                "label": sev_map.get(str(r["term"]), str(r["term"])),
                "count": r["count"]
            })

    # Yearly trend: use receivedate range - proper OpenFDA syntax
    yearly = []
    for year in range(2015, 2025):
        y_data = fda_get(
            search=f"receivedate:[{year}0101+TO+{year}1231]",
            limit=1
        )
        yearly.append({"year": year, "count": safe_total(y_data)})

    # Age group vs severity heatmap
    # OpenFDA age unit: patientagegroup field values:
    # 1=Neonate,2=Infant,3=Child,4=Adolescent,5=Adult,6=Elderly
    age_groups = [
        ("0-17",  "patient.patientagegroup:[1+TO+4]"),
        ("18-44", "patient.patientagegroup:5"),
        ("45-64", "patient.patientagegroup:5"),
        ("65+",   "patient.patientagegroup:6"),
    ]
    heatmap = []
    for label, age_q in age_groups:
        s = fda_get(search=f"serious:1+AND+{age_q}", limit=1)
        ns = fda_get(search=f"serious:2+AND+{age_q}", limit=1)
        heatmap.append({
            "age_group": label,
            "serious": safe_total(s),
            "not_serious": safe_total(ns),
        })

    return jsonify({
        "total_reports": total_reports,
        "severe_count": severe_count,
        "severe_pct": severe_pct,
        "top_drugs": top_drugs,
        "severity_dist": severity_dist,
        "yearly_trend": yearly,
        "heatmap": heatmap,
    })


@app.route("/api/search")
def search_drug():
    drug        = request.args.get("drug", "").strip().upper()
    reaction    = request.args.get("reaction", "").strip()
    year        = request.args.get("year", "").strip()
    age_group   = request.args.get("age_group", "").strip()

    if not drug:
        return jsonify({"error": "Drug name required"}), 400

    # Base drug search - use uppercase as FDA stores brand names in caps
    base = f'patient.drug.medicinalproduct:"{drug}"'

    # Add optional filters with AND
    filters = [base]
    if reaction:
        filters.append(f'patient.reaction.reactionmeddrapt:"{reaction.upper()}"')
    if year:
        filters.append(f"receivedate:[{year}0101+TO+{year}1231]")

    # Age group mapping using patientagegroup (more reliable than onsetage)
    age_q_map = {
        "0-17":  "patient.patientagegroup:[1+TO+4]",
        "18-44": "patient.patientagegroup:5",
        "45-64": "patient.patientagegroup:5",
        "65+":   "patient.patientagegroup:6",
    }
    if age_group in age_q_map:
        filters.append(age_q_map[age_group])

    drug_q = "+AND+".join(filters)

    # Total reports
    total_data = fda_get(search=drug_q, limit=1)
    total = safe_total(total_data)

    if total == 0:
        # Try without quotes (fuzzy match)
        base2 = f"patient.drug.medicinalproduct:{drug}"
        total_data2 = fda_get(search=base2, limit=1)
        total2 = safe_total(total_data2)
        if total2 > 0:
            drug_q = base2
            total = total2
        else:
            return jsonify({"error": f"No FDA records found for '{drug}'. Try brand name (e.g. TYLENOL instead of PARACETAMOL)."}), 404

    # Top 8 reactions
    react_data = fda_get(
        search=drug_q,
        count="patient.reaction.reactionmeddrapt.exact",
        limit=8
    )
    reactions = []
    if "results" in react_data:
        reactions = [{"reaction": r["term"], "count": r["count"]}
                     for r in react_data["results"][:8]]

    # Serious vs not-serious — critical fix: query separately
    serious_q     = drug_q + "+AND+serious:1"
    not_serious_q = drug_q + "+AND+serious:2"

    serious_data     = fda_get(search=serious_q, limit=1)
    not_serious_data = fda_get(search=not_serious_q, limit=1)

    serious_count     = safe_total(serious_data)
    not_serious_count = safe_total(not_serious_data)

    # Fallback if both 0 (some records don't have serious=2)
    if serious_count == 0 and not_serious_count == 0:
        not_serious_count = total - serious_count

    severe_pct = round(serious_count / total * 100, 1) if total else 0

    # Age group distribution
    age_buckets = [
        ("0-17",  "patient.patientagegroup:[1+TO+4]"),
        ("18-44", "patient.patientagegroup:5"),
        ("65+",   "patient.patientagegroup:6"),
    ]
    age_dist = []
    for label, aq in age_buckets:
        d = fda_get(search=drug_q + "+AND+" + aq, limit=1)
        age_dist.append({"age_group": label, "count": safe_total(d)})

    dominant_age = max(age_dist, key=lambda x: x["count"])["age_group"] if age_dist else "N/A"
    top_reaction = reactions[0]["reaction"] if reactions else "unknown"

    # Severity prediction score
    score = min(100, round(severe_pct * 1.3))
    if dominant_age == "65+":
        score = min(100, score + 15)
    if severe_pct > 70:
        score = min(100, score + 10)
    risk = "High" if score >= 60 else "Moderate" if score >= 30 else "Low"

    # Groq AI summary
    ai_summary = groq_summary(drug, total, reactions[:5], dominant_age, severe_pct, risk)

    return jsonify({
        "drug": drug,
        "total_reports": total,
        "reactions": reactions,
        "severity": {
            "serious": serious_count,
            "not_serious": not_serious_count,
            "severe_pct": severe_pct,
        },
        "age_dist": age_dist,
        "dominant_age": dominant_age,
        "top_reaction": top_reaction,
        "prediction": {"severity_score": score, "risk_level": risk},
        "ai_summary": ai_summary,
    })


def groq_summary(drug, total, reactions, dominant_age, severe_pct, risk):
    rxlist = ", ".join(r["reaction"] for r in reactions) if reactions else "various reactions"
    prompt = (
        f"You are a pharmaceutical safety analyst. Based on real FDA adverse event data, "
        f"write a 2-3 sentence clinical insight for {drug}.\n\n"
        f"Data:\n"
        f"- Total FDA reports: {total:,}\n"
        f"- Top reactions: {rxlist}\n"
        f"- Most affected age group: {dominant_age}\n"
        f"- Serious event rate: {severe_pct}%\n"
        f"- Risk classification: {risk}\n\n"
        f"Write a concise professional conclusion starting with the drug name. No bullets."
    )
    try:
        resp = groq_client.chat.completions.create(
            model="llama3-8b-8192",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200,
            temperature=0.4,
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        return (
            f"{drug} shows {severe_pct}% serious adverse event rate across {total:,} FDA reports. "
            f"The most frequently reported reactions include {rxlist}, "
            f"with the {dominant_age} age group most affected. "
            f"Overall risk classification: {risk}."
        )


if __name__ == "__main__":
    app.run(debug=True, port=5000)

# main.py

import base64, json, os, fitz
import firebase_admin
from firebase_admin import firestore
from firebase_functions import https_fn
from google.cloud import storage
from google import genai
from google.genai import types

# ---- Allowed origins (exact) ----
ALLOWED_ORIGINS = {
    "http://localhost:3000",
    "https://petershumuen.github.io",
}

# If you want to accept any *.github.io page (project/user pages), keep this True.
ALLOW_GITHUB_IO_WILDCARD = True

def _normalize_origin(o: str | None) -> str | None:
    if not o:
        return None
    # Lowercase, strip trailing slash
    return o.strip().lower().rstrip("/")

def _is_allowed_origin(origin: str | None) -> bool:
    o = _normalize_origin(origin)
    if not o:
        return False
    if o in { _normalize_origin(x) for x in ALLOWED_ORIGINS }:
        return True
    if ALLOW_GITHUB_IO_WILDCARD and o.endswith(".github.io"):
        return True
    return False

def _cors_headers_for(origin: str | None, *, credentials: bool = False):
    """
    Return CORS headers. If origin allowed -> echo it.
    Otherwise, you can choose to be permissive and echo the origin, or send '*'.
    """
    headers = {"Vary": "Origin"}
    if _is_allowed_origin(origin):
        headers["Access-Control-Allow-Origin"] = origin
        if credentials:
            headers["Access-Control-Allow-Credentials"] = "true"
    else:
        # --- Option A (more permissive): reflect whatever origin we got (no credentials) ---
        if origin:
            headers["Access-Control-Allow-Origin"] = origin
        else:
            headers["Access-Control-Allow-Origin"] = "*"
        # --- Option B (strict): uncomment the next line and remove the two lines above
        # headers["Access-Control-Allow-Origin"] = "null"
    return headers

def _cors_preflight_headers(origin: str | None):
    h = _cors_headers_for(origin)
    h.update({
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "3600",
    })
    return h

# ---- Firebase Admin ----
firebase_admin.initialize_app()

# ---- GenAI client (Vertex backend) ----
_GENAI_CLIENT = None
def _genai_client():
    global _GENAI_CLIENT
    if not _genai_client:
        pass
    return None
def _genai_client():
    global _GENAI_CLIENT
    if not _GENAI_CLIENT:
        cfg = json.loads(os.environ.get("FIREBASE_CONFIG", "{}"))
        project = cfg.get("projectId") or os.environ.get("GCP_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT")
        loc = os.environ.get("VERTEX_LOCATION", "us-central1")
        _GENAI_CLIENT = genai.Client(vertexai=True, project=project, location=loc)
    return _GENAI_CLIENT

def _get_bucket():
    cfg = json.loads(os.environ.get("FIREBASE_CONFIG", "{}"))
    bucket = cfg.get("storageBucket")
    if not bucket:
        raise RuntimeError("storageBucket missing in FIREBASE_CONFIG")
    return bucket

def _decode_data_uri(data_uri):
    if not data_uri or "," not in data_uri:
        raise ValueError("Invalid data URI")
    header, b64 = data_uri.split(",", 1)
    mt = header.split(";")[0][5:] if header.startswith("data:") else ""
    return base64.b64decode(b64), (mt or "application/octet-stream")

@https_fn.on_request(memory=512)
def analyze_blueprint(req):
    origin = req.headers.get("Origin")
    # Helpful log to confirm what origin the server sees:
    print(f"[CORS] Origin received: {origin}")

    if req.method == "OPTIONS":
        return https_fn.Response("", status=204, headers=_cors_preflight_headers(origin))
    if req.method != "POST":
        return https_fn.Response("Method not allowed", 405, headers=_cors_headers_for(origin))

    try:
        data = req.get_json(silent=True) or {}
        if not all(k in data for k in ["fileData","projectName","address","clientName","userId"]):
            return https_fn.Response("Missing fields", 400, headers=_cors_headers_for(origin))

        raw, mt = _decode_data_uri(data["fileData"])
        if mt.lower() == "application/pdf":
            pdf = fitz.open(stream=raw, filetype="pdf")
            pix = pdf.load_page(0).get_pixmap(dpi=150)
            img_bytes = pix.tobytes("png")
            pdf.close()
            mt_out = "image/png"
        else:
            img_bytes = raw
            mt_out = "image/png" if mt.lower().startswith("image/") else mt

        bucket_name = _get_bucket()
        storage_client = storage.Client()
        bucket = storage_client.bucket(bucket_name)

        db = firestore.client()
        doc = db.collection("projects").document()
        fname = f"blueprints/{data['userId']}/{data['projectName']}_{doc.id}.png"
        blob = bucket.blob(fname)
        blob.upload_from_string(img_bytes, content_type=mt_out)
        blueprint_url = blob.public_url

        client_ai = _genai_client()
        prompt = "Analyze this blueprint image and return ONLY a JSON object..."
        resp = client_ai.models.generate_content(
            model="gemini-2.0-flash-001",
            contents=[prompt, types.Part.from_bytes(data=img_bytes, mime_type=mt_out)]
        )
        txt = (resp.text or "").strip().replace("```json", "").replace("```", "")
        try:
            analysis = json.loads(txt)
        except Exception:
            analysis = {"error": "parseFailure"}

        db.collection("projects").document(doc.id).set({
            "userId": data["userId"],
            "projectName": data["projectName"],
            "address": data["address"],
            "clientName": data["clientName"],
            "blueprintUrl": blueprint_url,
            "analysisResult": analysis,
            "createdAt": firestore.SERVER_TIMESTAMP
        })

        return https_fn.Response(
            json.dumps({"analysisResult": analysis}),
            200,
            mimetype="application/json",
            headers=_cors_headers_for(origin),
        )

    except Exception as e:
        print("Error:", e)
        return https_fn.Response(
            json.dumps({"error": str(e)}),
            500,
            mimetype="application/json",
            headers=_cors_headers_for(origin),
        )

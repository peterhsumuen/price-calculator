import uuid
import base64
import json
import os
import fitz  # PyMuPDF
import firebase_admin
from firebase_functions import https_fn, options

# --- Google Cloud Client Libraries ---
from google.api_core import client_options
from google.cloud import storage
from google.cloud import speech_v2
import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig, Part

# --- Global Configuration & CORS ---
# Set the region for all functions in this file
options.set_global_options(region="us-central1")

ALLOWED_ORIGINS = {
    "http://localhost:3000",
    "https://petershumuen.github.io",
}
ALLOW_GITHUB_IO_WILDCARD = True

def _is_allowed_origin(origin: str | None) -> bool:
    if not origin:
        return False
    o = origin.strip().lower().rstrip("/")
    if o in {o.strip().lower().rstrip("/") for o in ALLOWED_ORIGINS}:
        return True
    if ALLOW_GITHUB_IO_WILDCARD and o.endswith(".github.io"):
        return True
    return False

def _cors_headers_for(origin: str | None):
    headers = {"Vary": "Origin"}
    if _is_allowed_origin(origin):
        headers["Access-Control-Allow-Origin"] = origin
    else:
        headers["Access-Control-Allow-Origin"] = "*"  # More permissive for simplicity (no credentials)
    return headers

def _cors_preflight_headers(origin: str | None):
    h = _cors_headers_for(origin)
    h.update({
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "3600",
    })
    return h

# --- Lazy-Initialized Clients ---
# We declare clients globally but only initialize them on the first function call.
# This prevents deployment timeouts and is the recommended best practice.
PROJECT_ID = (
    os.environ.get("GCLOUD_PROJECT")
    or os.environ.get("GCP_PROJECT")
    or json.loads(os.environ.get("FIREBASE_CONFIG", "{}")).get("projectId")
)
if not PROJECT_ID:
    raise RuntimeError("PROJECT_ID not found in env (GCLOUD_PROJECT/GCP_PROJECT/FIREBASE_CONFIG).")

LOCATION = "us-central1"

speech_client = None
gemini_model = None
storage_client = None
vertex_ai_initialized = False

def _initialize_clients():
    """Initializes all API clients lazily."""
    global speech_client, gemini_model, storage_client, vertex_ai_initialized

    if not vertex_ai_initialized:
        vertexai.init(project=PROJECT_ID, location=LOCATION)
        vertex_ai_initialized = True

    if storage_client is None:
        storage_client = storage.Client()

    if speech_client is None:
        opts = client_options.ClientOptions(
            api_endpoint=f"{LOCATION}-speech.googleapis.com"
        )
        speech_client = speech_v2.SpeechClient(client_options=opts)

    if gemini_model is None:
        gemini_model = GenerativeModel("gemini-2.5-pro")

# --- Helper Functions ---
def _get_bucket_name():
    cfg = json.loads(os.environ.get("FIREBASE_CONFIG", "{}"))
    bucket = cfg.get("storageBucket")
    if not bucket:
        raise RuntimeError("storageBucket missing from FIREBASE_CONFIG")
    return bucket

def _decode_data_uri(data_uri):
    if not data_uri or "," not in data_uri:
        raise ValueError("Invalid data URI")
    header, b64_data = data_uri.split(",", 1)
    mime_type = header.split(";")[0][5:] if header.startswith("data:") else "application/octet-stream"
    return base64.b64decode(b64_data), mime_type

# --- Cloud Functions ---

@https_fn.on_request(memory=4096)
def analyze_blueprint(req: https_fn.Request) -> https_fn.Response:
    origin = req.headers.get("Origin")

    if req.method == "OPTIONS":
        return https_fn.Response("", status=204, headers=_cors_preflight_headers(origin))

    if req.method != "POST":
        return https_fn.Response("Method Not Allowed", status=405, headers=_cors_headers_for(origin))

    try:
        _initialize_clients()  # Ensure clients are ready

        # CORRECT: Moved prompt definition to the top so it exists before being used.
        prompt = """
        Your primary goal is to analyze all provided blueprint pages to generate a clear "Scope of Work". After that, fill in any other details you can find. Your task is to extract all information and format it into a precise JSON structure.

        Follow these instructions carefully for each key:

        1.  **Top-Level Keys:**
            * `Project Name`: **Find the project's title, often the first line of the project description.**
            * `Project Description`: **Summary of the blueprint in a big scope like bathroom remodeling, kitchen remodeling...**
            * `Project Address`: **Find the physical address of the job site. Look for labels like "PROJECT ADDRESS", "SITE ADDRESS", or "JOBSITE LOCATION".**
            * `Client Name`: **Find the name of the property owner or client. Look for labels like "OWNER", "CLIENT", "APPLICANT", or "PREPARED FOR".**
            * `Zone District`: **Find the zoning code for the property. Look for labels like "ZONE DISTRICT", "ZONING", or "PARCEL ZONING".**
            * `Type of Construction`: **Find the construction classification. Look for labels like "TYPE OF CONSTRUCTION" or "CONSTRUCTION TYPE".**
            * `Occupancy Group`: **Find the occupancy classification code. Look for labels like "OCCUPANCY GROUP", "OCCUPANCY", or "GROUP".**
            * `Scope of Work`: **Act as a project manager writing a formal Scope of Work for a homeowner. Using all provided blueprint pages, create a thorough, step-by-step detail description of the entire project. Structure the output by area or room. For each location, use clear headings (e.g., Kitchen Remodel, Second Floor Addition, Exterior Work) and detail the following in plain language:
                - Demolition: Clearly state what existing structures will be removed.
                - Construction & Framing: Describe all new construction.
                - Mechanical, Electrical & Plumbing (MEP): Detail any new installations or relocations shown on the plans.
                - Finishes & Fixtures: List all new finishes and permanent fixtures.
                - Ensure the final text is a comprehensive narrative that walks the homeowner through the entire construction journey from start to finish.**
                
        2.  **Nested "Remodeling place and size" Object:**
            - `Full gut`: Do not fill in this unless it says Full gut or whole house remodeling on the plan.
            - `Additional building/ new construction`: Look for areas marked "ADDITION" or "NEW". Calculate their total square footage.
            - `Structural Wall removal`: Look for notes indicating wall demolition. If found, use the same value as `Full gut`.
            - `Kitchen`: Find the area labeled "KITCHEN" and use its size.
            - `Bathroom`: Find the area labeled "BATH" and use its size.
            - `Living room`: Find the area labeled "LIVING ROOM" or "LIVING/DINING" and use its size.
            - `Garage`: Find the area labeled "GARAGE" and use its size.
            - `Bedroom`: Find any area labeled "BEDROOM" and use its size. 
            - `Landscape`: Look for landscaping plans.
            - If there are multiple rooms of the same type, add their sizes together.

        Your final output must be ONLY a single, valid JSON object. Do not add any other text or explanations.

        ```json
        {
          "Project Name": "REMODEL EXISTING 1-STORY HOUSE",
          "Project Description": "REMODEL EXISTING 1-STORY HOUSE\n- REMODEL 1244.5 SQ.FT. OF LIVING AREA",
          "Project Address": "1975 ALMA STREET, PALO ALTO",
          "Client Name": "TIFFANY TSAO",
          "Scope of Work": "This project involves the remodel of the 1,244.5 sq. ft. living area...",
          "Remodeling place and size": { "Living room": 1244.5 },
          "Zone District": "RM-20",
          "Type of Construction": "V-B, NO SPRINKLER",
          "Occupancy Group": "R-3 / U"
        }
        ```
        """

        data = req.get_json(silent=True) or {}
        if "fileData" not in data or "userId" not in data:
            return https_fn.Response("Missing fields", status=400, headers=_cors_headers_for(origin))

        raw_bytes, mime_type = _decode_data_uri(data["fileData"])

        content_for_gemini = [prompt]
        first_page_bytes = None  # To store the first page for upload

        if mime_type.lower() == "application/pdf":
            with fitz.open(stream=raw_bytes, filetype="pdf") as doc:
                for page_num in range(doc.page_count):
                    page = doc.load_page(page_num)
                    pix = page.get_pixmap(dpi=300)
                    image_bytes = pix.tobytes("png")
                    if page_num == 0:
                        first_page_bytes = image_bytes  # Save first page
                    content_for_gemini.append(Part.from_data(data=image_bytes, mime_type="image/png"))
        else:
            first_page_bytes = raw_bytes  # It's just a single image
            content_for_gemini.append(Part.from_data(data=raw_bytes, mime_type=mime_type))

        if not first_page_bytes:
            raise ValueError("No image data could be processed for upload.")

        bucket_name = _get_bucket_name()
        bucket = storage_client.bucket(bucket_name)
        fname = f"blueprints/{data['userId']}/{uuid.uuid4()}.png"
        blob = bucket.blob(fname)
        # Upload only the first page as a thumbnail.
        blob.upload_from_string(first_page_bytes, content_type="image/png")

        # Send the full list of content (prompt + all images) to Gemini.
        response = gemini_model.generate_content(content_for_gemini)

        raw_text = response.text.strip().replace("```json", "").replace("```", "")
        analysis = json.loads(raw_text)

        response_data = {"analysisResult": analysis, "blueprintUrl": blob.public_url}
        return https_fn.Response(json.dumps(response_data), status=200, mimetype="application/json", headers=_cors_headers_for(origin))

    except Exception as e:
        print(f"Error in analyze_blueprint: {e}")
        return https_fn.Response(json.dumps({"error": str(e)}), status=500, mimetype="application/json", headers=_cors_headers_for(origin))


@https_fn.on_request(memory=4096, timeout_sec=540)
def analyze_voice_recording(req: https_fn.Request) -> https_fn.Response:
    origin = req.headers.get("Origin")

    if req.method == "OPTIONS":
        return https_fn.Response("", status=204, headers=_cors_preflight_headers(origin))

    if req.method != "POST":
        return https_fn.Response("Method Not Allowed", status=405, headers=_cors_headers_for(origin))

    try:
        _initialize_clients()

        data = req.get_json(silent=True) or {}
        if "audioData" not in data or "sampleRate" not in data:
            return https_fn.Response(
                json.dumps({"error": "Bad Request: 'audioData' not found"}),
                status=400, mimetype="application/json", headers=_cors_headers_for(origin)
            )
        
        # Get the sample rate from the request
        sample_rate = data["sampleRate"]

        # Decode the data URI and capture the original mime
        audio_content, mime_type = _decode_data_uri(data["audioData"])
        if not audio_content:
            return https_fn.Response(
                json.dumps({"error": "Bad Request: Audio data is empty"}),
                status=400, mimetype="application/json", headers=_cors_headers_for(origin)
            )

        # Inspect the incoming mime; many browsers give variants like:
        # - "audio/webm;codecs=opus"
        # - "audio/ogg;codecs=opus"
        # - "audio/mp4" or "audio/m4a" (AAC)  <-- not supported by v2 decoders
        mime_lower = (mime_type or "").lower()
        print(f"[analyze_voice_recording] Incoming mime: {mime_lower}, bytes={len(audio_content)}")

        # Decide container/codec for v2 ExplicitDecodingConfig
        # Supported by v2: WEBM_OPUS, OGG_OPUS, FLAC, MP3, LINEAR16 (WAV), etc.
        if "webm" in mime_lower:
            decoding_encoding = speech_v2.ExplicitDecodingConfig.AudioEncoding.WEBM_OPUS
        elif "ogg" in mime_lower:
            decoding_encoding = speech_v2.ExplicitDecodingConfig.AudioEncoding.OGG_OPUS
        elif "mp4" in mime_lower or "m4a" in mime_lower or "aac" in mime_lower:
            # v2 doesn't have an MP4/AAC explicit decoding enum. You must transcode server-side
            # (e.g., to LINEAR16) or record as WebM Opus from the browser.
            return https_fn.Response(
                json.dumps({
                    "error": (
                        "Your browser produced MP4/M4A (AAC), which Speech v2 cannot decode directly. "
                        "Please record as WebM Opus (recommended) or transcode to WAV/LINEAR16 on the server "
                        "before sending to Speech v2."
                    ),
                    "hint": "Use MediaRecorder with mimeType 'audio/webm;codecs=opus' on Chrome/Edge. iOS Safari usually produces AAC."
                }),
                status=400, mimetype="application/json", headers=_cors_headers_for(origin)
            )
        else:
            # Unknown container: we can still try WEBM_OPUS as a guess, but better to fail clearly.
            return https_fn.Response(
                json.dumps({
                    "error": f"Unsupported audio container: {mime_type}",
                    "hint": "Use 'audio/webm;codecs=opus' or 'audio/ogg;codecs=opus'."
                }),
                status=400, mimetype="application/json", headers=_cors_headers_for(origin)
            )

        # 1) Upload audio to a temporary location in Google Cloud Storage
        bucket_name = _get_bucket_name()
        bucket = storage_client.bucket(bucket_name)

        unique_id = uuid.uuid4()
        # Preserve an extension that matches the container, purely for sanity
        if decoding_encoding == speech_v2.ExplicitDecodingConfig.AudioEncoding.WEBM_OPUS:
            ext = "webm"
            upload_mime = "audio/webm"
        else:
            ext = "ogg"
            upload_mime = "audio/ogg"

        audio_file_name = f"audio_recordings/{unique_id}.{ext}"
        gcs_uri = f"gs://{bucket_name}/{audio_file_name}"

        audio_blob = bucket.blob(audio_file_name)
        audio_blob.upload_from_string(audio_content, content_type=upload_mime)
        print(f"[analyze_voice_recording] Uploaded to {gcs_uri}")

        # Helper to run BatchRecognize with a given channel count (2 -> 1 fallback)
        def _run_batch_recognize(channel_count: int):
            # Most Opus recordings are 48kHz; if your recorder is 44100, change this.
            explicit_config = speech_v2.ExplicitDecodingConfig(
                encoding=decoding_encoding,
                sample_rate_hertz=sample_rate,           # Opus typically 48000; adjust if you know yours is different
                audio_channel_count=channel_count   # try 2 first, then 1
            )

            features = speech_v2.RecognitionFeatures(
                enable_automatic_punctuation=True
            )

            recognition_config = speech_v2.RecognitionConfig(
                explicit_decoding_config=explicit_config,
                language_codes=["en-US"],
                model="chirp_2",
                features=features
            )

            # v2 requires an output config; we'll use inline to avoid GCS perms
            output_config = speech_v2.RecognitionOutputConfig(
                inline_response_config=speech_v2.InlineOutputConfig()
            )

            request = speech_v2.BatchRecognizeRequest(
                recognizer=f"projects/{PROJECT_ID}/locations/{LOCATION}/recognizers/_",
                config=recognition_config,
                files=[speech_v2.BatchRecognizeFileMetadata(uri=gcs_uri)],
                recognition_output_config=output_config
            )

            op = speech_client.batch_recognize(request=request)
            return op.result(timeout=480)

        def _has_nonzero_error(fr):
            return bool(getattr(fr, "error", None) and getattr(fr.error, "code", 0) != 0)

        # 2) Process audio as mono (since the frontend records in mono)
        operation_result = _run_batch_recognize(channel_count=1)
        file_result = operation_result.results.get(gcs_uri)

        if not file_result:
            raise ValueError(f"No result found for the audio file URI: {gcs_uri}")

        if _has_nonzero_error(file_result):
            raise ValueError(f"Speech API error code {file_result.error.code}: {file_result.error.message}")

        # Extract transcript
        if not getattr(file_result, "transcript", None) or not file_result.transcript.results:
            # If we got here, decoding might have succeeded but the audio was near-silence or too short
            # (or sample rate didn't actually match). Surface a clearer error for debugging.
            raise ValueError(
                "Transcription completed but returned no text. "
                "Possible causes: near-silence/very short audio, wrong sample_rate_hertz, or a codec/container mismatch."
            )

        alts = file_result.transcript.results[0].alternatives
        if not alts:
            raise ValueError("No alternatives returned.")

        transcript = alts[0].transcript
        print(f"[analyze_voice_recording] Transcript length: {len(transcript)}")

        # 3) Clean up temporary audio file
        try:
            audio_blob.delete()
        except Exception as _:
            pass

        # --- Gemini analysis prompt (same as yours) ---
        prompt = f"""
        Analyze the following transcribed text from a client meeting. Your task is to first extract key project details into a JSON format. 

        Your primary goal is to analyze all provided transcribed text to generate a clear "Scope of Work". After that, fill in any other details you can find. Your task is to extract all information and format it into a precise JSON structure.

        Follow these instructions carefully for each key:

        1.  **Top-Level Keys:**
            * `Project Name`: **Find the project's title, often the first line of the project description.**
            * `Project Description`: **Summary of the blueprint in a big scope like bathroom remodeling, kitchen remodeling...**
            * `Project Address`: **Find the physical address of the job site. Look for labels like "PROJECT ADDRESS", "SITE ADDRESS", or "JOBSITE LOCATION".**
            * `Client Name`: **Find the name of the property owner or client. Look for labels like "OWNER", "CLIENT", "APPLICANT", or "PREPARED FOR".**
            * `Zone District`: **Find the zoning code for the property. Look for labels like "ZONE DISTRICT", "ZONING", or "PARCEL ZONING".**
            * `Type of Construction`: **Find the construction classification. Look for labels like "TYPE OF CONSTRUCTION" or "CONSTRUCTION TYPE".**
            * `Occupancy Group`: **Find the occupancy classification code. Look for labels like "OCCUPANCY GROUP", "OCCUPANCY", or "GROUP".**
            * `Scope of Work`: **Act as a project manager writing a formal Scope of Work for a homeowner. Using all provided transcribed text, create a thorough, step-by-step detail description of the entire project. Structure the output by area or room. For each location, use clear headings (e.g., Kitchen Remodel, Second Floor Addition, Exterior Work) and detail the following in plain language:
                - Demolition: Clearly state what existing structures will be removed.
                - Construction & Framing: Describe all new construction.
                - Mechanical, Electrical & Plumbing (MEP): Detail any new installations or relocations shown on the plans.
                - Finishes & Fixtures: List all new finishes and permanent fixtures.
                - Ensure the final text is a comprehensive narrative that walks the homeowner through the entire construction journey from start to finish.**
                
        2.  **Nested "Remodeling place and size" Object:**
            - `Full gut`: Do not fill in this unless it says Full gut or whole house remodeling on the plan.
            - `Additional building/ new construction`: Look for areas marked "ADDITION" or "NEW". Calculate their total square footage.
            - `Structural Wall removal`: Look for notes indicating wall demolition. If found, use the same value as `Full gut`.
            - `Kitchen`: Find the area labeled "KITCHEN" and use its size.
            - `Bathroom`: Find the area labeled "BATH" and use its size.
            - `Living room`: Find the area labeled "LIVING ROOM" or "LIVING/DINING" and use its size.
            - `Garage`: Find the area labeled "GARAGE" and use its size.
            - `Bedroom`: Find any area labeled "BEDROOM" and use its size. 
            - `Landscape`: Look for landscaping plans.
            - If there are multiple rooms of the same type, add their sizes together.

        Your final output must be ONLY a single, valid JSON object. Do not add any other text or explanations.

        **JSON Output format:**
        {{
            "Project Name": "...",
            "Project Description": "...",
            "Project Address": "...",
            "Client Name": "...",
            "Scope of Work": "...",
            "Remodeling place and size": {{
                "Full gut": null,
                "Additional building/ new construction": null,
                "Structural Wall removal": null,
                "2nd Structural Wall removal": null,
                "Kitchen": null,
                "Bathroom": null,
                "Living room": null,
                "Garage": null,
                "Bedroom": null,
                "Landscape": null
            }},
            "Zone District": "...",
            "Type of Construction": "...",
            "Occupancy Group": "..."
        }}
        """

        full_prompt_for_gemini = f"{prompt}\n\nTranscribed Text:\n{transcript}"

        gemini_response = gemini_model.generate_content(
            full_prompt_for_gemini,
            generation_config=GenerationConfig(response_mime_type="application/json")
        )
        analysis_json = json.loads(gemini_response.text)

        response_data = {"transcript": transcript, "analysis": analysis_json}
        return https_fn.Response(json.dumps(response_data, indent=2), status=200,
                                 mimetype="application/json", headers=_cors_headers_for(origin))

    except Exception as e:
        print(f"Error in analyze_voice_recording: {e}")
        return https_fn.Response(json.dumps({"error": str(e)}), status=500,
                                 mimetype="application/json", headers=_cors_headers_for(origin))

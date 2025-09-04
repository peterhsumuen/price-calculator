import uuid
import base64
import json
import os
import fitz  # PyMuPDF
import firebase_admin
from firebase_functions import https_fn, options

# --- Google Cloud Client Libraries ---
from google.cloud import storage
from google.cloud.speech_v2 import SpeechClient
from google.cloud.speech_v2.types import cloud_speech
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
        headers["Access-Control-Allow-Origin"] = "*" # More permissive for simplicity
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
PROJECT_ID = os.environ.get("GCLOUD_PROJECT")
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
        speech_client = SpeechClient()

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
        _initialize_clients() # Ensure clients are ready

        # CORRECT: Moved prompt definition to the top so it exists before being used.
        prompt = """
        Your primary goal is to analyze all provided blueprint pages to generate a clear "Scope of Work". After that, fill in any other details you can find. Your task is to extract all information and format it into a precise JSON structure.

        Follow these instructions carefully for each key:

        1.  **Top-Level Keys:**
            * `Project Name`: **Find the project's title, often the first line of the project description.**
            * `Project Description`: **Find the full, multi-line description of the project.**
            * `Project Address`: **Find the physical address of the job site. Look for labels like "PROJECT ADDRESS", "SITE ADDRESS", or "JOBSITE LOCATION".**
            * `Client Name`: **Find the name of the property owner or client. Look for labels like "OWNER", "CLIENT", "APPLICANT", or "PREPARED FOR".**
            * `Zone District`: **Find the zoning code for the property. Look for labels like "ZONE DISTRICT", "ZONING", or "PARCEL ZONING".**
            * `Type of Construction`: **Find the construction classification. Look for labels like "TYPE OF CONSTRUCTION" or "CONSTRUCTION TYPE".**
            * `Occupancy Group`: **Find the occupancy classification code. Look for labels like "OCCUPANCY GROUP", "OCCUPANCY", or "GROUP".**
            * `Scope of Work`: **Act as a project manager writing a formal Scope of Work for a homeowner. Using all provided blueprint pages, create a thorough, step-by-step description of the entire project. Structure the output by area or room. For each location, use clear headings (e.g., Kitchen Remodel, Second Floor Addition, Exterior Work) and detail the following in plain language:
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
        first_page_bytes = None # To store the first page for upload

        if mime_type.lower() == "application/pdf":
            with fitz.open(stream=raw_bytes, filetype="pdf") as doc:
                for page_num in range(doc.page_count):
                    page = doc.load_page(page_num)
                    pix = page.get_pixmap(dpi=300)
                    image_bytes = pix.tobytes("png")
                    if page_num == 0:
                        first_page_bytes = image_bytes # Save first page
                    content_for_gemini.append(Part.from_data(data=image_bytes, mime_type="image/png"))
        else:
            first_page_bytes = raw_bytes # It's just a single image
            content_for_gemini.append(Part.from_data(data=raw_bytes, mime_type=mime_type))

        if not first_page_bytes:
             raise ValueError("No image data could be processed for upload.")

        bucket_name = _get_bucket_name()
        bucket = storage_client.bucket(bucket_name)
        fname = f"blueprints/{data['userId']}/{uuid.uuid4()}.png"
        blob = bucket.blob(fname)
        # CORRECT: Upload only the first page as a thumbnail.
        blob.upload_from_string(first_page_bytes, content_type="image/png")

        # CORRECT: Send the full list of content (prompt + all images) to Gemini.
        response = gemini_model.generate_content(content_for_gemini)
        
        raw_text = response.text.strip().replace("```json", "").replace("```", "")
        analysis = json.loads(raw_text)

        response_data = {"analysisResult": analysis, "blueprintUrl": blob.public_url}
        return https_fn.Response(json.dumps(response_data), status=200, mimetype="application/json", headers=_cors_headers_for(origin))

    except Exception as e:
        print(f"Error in analyze_blueprint: {e}")
        return https_fn.Response(json.dumps({"error": str(e)}), status=500, mimetype="application/json", headers=_cors_headers_for(origin))



@https_fn.on_request(memory=2048)
def analyze_voice_recording(req: https_fn.Request) -> https_fn.Response:
    origin = req.headers.get("Origin")

    if req.method == "OPTIONS":
        return https_fn.Response("", status=204, headers=_cors_preflight_headers(origin))

    if req.method != "POST":
        return https_fn.Response("Method Not Allowed", status=405, headers=_cors_headers_for(origin))

    try:
        _initialize_clients() # Ensure clients are ready

        data = req.get_json(silent=True) or {}
        if "audioData" not in data:
            return https_fn.Response(json.dumps({"error": "Bad Request: 'audioData' not found in JSON payload"}), status=400, mimetype="application/json", headers=_cors_headers_for(origin))
        
        # Decode the base64 data URI from the frontend
        audio_content, _ = _decode_data_uri(data["audioData"])
        if not audio_content:
            return https_fn.Response(json.dumps({"error": "Bad Request: Audio data is empty"}), status=400, mimetype="application/json", headers=_cors_headers_for(origin))
            
        recognizer_path = f"projects/{PROJECT_ID}/locations/global/recognizers/_"
        recognition_config = cloud_speech.RecognitionConfig(auto_decoding_config={}, language_codes=["en-US"], model="chirp")
        request = cloud_speech.RecognizeRequest(recognizer=recognizer_path, config=recognition_config, content=audio_content)
        
        transcription_response = speech_client.recognize(request=request)
        if not transcription_response.results or not transcription_response.results[0].alternatives:
             raise ValueError("Transcription failed or returned empty.")
        transcript = transcription_response.results[0].alternatives[0].transcript

        # --- This part for Gemini analysis remains the same ---
        prompt = f"""
        Analyze the following transcribed text from a client meeting. Your task is to first extract key project details into a JSON format. Second, provide a detailed summary of any other remodeling-related topics that were discussed.

        **Instructions for JSON Output:**
        - Fill in each key based on the information provided in the conversation.
        - **`Scope of Work`: Create a shorter version summary of the main project goals discussed. This should be a concise version of the main summary below.**

        **JSON Output format:**
        {{
            "Project Name": "...",
            "Project Description": "...",
            "Project Address": "...",
            "Client Name": "...",
            **"Scope of Work": "...",**
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

        **Summary of other remodeling topics:**
        - ...
        """
        
        # Create a combined text for Gemini
        full_prompt_for_gemini = f"{prompt}\n\nTranscribed Text:\n{transcript}"

        gemini_response = gemini_model.generate_content(
            full_prompt_for_gemini,
            generation_config=GenerationConfig(response_mime_type="application/json")
        )
        analysis_json = json.loads(gemini_response.text)

        response_data = {"transcript": transcript, "analysis": analysis_json}
        return https_fn.Response(json.dumps(response_data, indent=2), status=200, mimetype="application/json", headers=_cors_headers_for(origin))

    except Exception as e:
        print(f"Error in analyze_voice_recording: {e}")
        return https_fn.Response(json.dumps({"error": str(e)}), status=500, mimetype="application/json", headers=_cors_headers_for(origin))
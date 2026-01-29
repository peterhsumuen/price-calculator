import uuid
import base64
import json
import os
import fitz  
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
        headers["Access-Control-Allow-Origin"] = "*"  
    return headers

def _cors_preflight_headers(origin: str | None):
    h = _cors_headers_for(origin)
    h.update({
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "3600",
    })
    return h

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

def _merge_analysis_results(results):
    """
    Merges a list of JSON analysis results from Gemini into a single result.
    """
    if not results:
        return {}

    merged = results[0]
    
    # Ensure the initial "Scope of Work" is a string to begin with.
    # The .get() method safely handles cases where the key might be missing.
    scope_text = merged.get("Scope of Work", "")
    if isinstance(scope_text, dict):
        # Convert dictionary to a string representation if needed
        scope_text = json.dumps(scope_text, indent=2) 
    
    # Iterate over subsequent results to append their scopes
    for result in results[1:]:
        next_scope_text = result.get("Scope of Work", "")
        if next_scope_text:
            # Also ensure the next scope is a string before appending
            if isinstance(next_scope_text, dict):
                next_scope_text = json.dumps(next_scope_text, indent=2)
            scope_text += "\n\n" + next_scope_text

    merged["Scope of Work"] = scope_text
    return merged

# --- Cloud Functions ---

@https_fn.on_request(memory=8192, timeout_sec=3600)
def analyze_blueprint(req: https_fn.Request) -> https_fn.Response:
    origin = req.headers.get("Origin")

    if req.method == "OPTIONS":
        return https_fn.Response("", status=204, headers=_cors_preflight_headers(origin))

    if req.method != "POST":
        return https_fn.Response("Method Not Allowed", status=405, headers=_cors_headers_for(origin))

    try:
        _initialize_clients()

        CHUNK_SIZE = 5 
        TEXT_THRESHOLD = 1500
        
        prompt = """

        Your primary goal is to act as an expert construction project manager and estimator. Analyze all provided blueprint pages to generate a comprehensive, detailed, and client-friendly "Scope of Work". After generating the SOW, fill in any other details you can find. Your task is to extract, analyze, and format all information into a precise JSON structure.



        Follow these instructions carefully for each key:



        1.  **Top-Level Keys:**

            * `Project Name`: **Find the project's title, often the first line of the project description.**

            * `Project Description`: **Provide a concise summary of the project's main objectives (e.g., complete interior remodel, kitchen and bath renovation, creating a new bathroom, etc.).**

            * `Project Address`: **Find the physical address of the job site.**

            * `Client Name`: **Find the name of the property owner or client.**

            * `Scope of Work`: **This is the most critical section. Write a formal, narrative-style Scope of Work for a homeowner. Use all blueprint pages (Architectural, Structural, MEP, etc.) to create a thorough, step-by-step description. Cross-reference all pages to ensure consistency and capture all details.**



                **Expert Analysis & Detail Inference:**

                * **Go Beyond the Obvious:** Do not just list what you see. Infer standard construction practices. For example, if you see a new shower, include the installation of a waterproof membrane, a custom shower pan, and tile backer board. If there's a new kitchen, mention under-cabinet lighting.

                * **Identify High-Quality Features:** Look for notes that imply a higher standard of work, such as "Level 5 smooth finish", "solid-core doors", "dimmer switches", or specific material types like "copper supply lines".

                * **Consider Future Needs & Codes:** As seen in the best examples, include forward-thinking details like installing "2x8 blocking in walls for future grab bar installation" in bathrooms, which is a best practice. Mention code requirements like "tamper-resistant outlets" or "GFCI protection" where applicable.



                    **Structure the SOW by Phase:**



                    **1. Pre-Construction & Project Management**

                        -   Permitting & Inspections: Detail the plan to prepare and submit plans, pull all necessary city permits (Building, Electrical, Plumbing, Mechanical), and coordinate all required city inspections from foundation to final.

                        -   Site Logistics: Describe on-site management, and the setup of temporary facilities like construction fencing, portable restrooms, and regular debris disposal schedules. Crucially, detail the implementation and maintenance of the site's Erosion Control plan and Stormwater Pollution Prevention Plan (SWPPP) as required by local authorities. Specify the installation of measures like silt fences, gravel bags at inlets, and a designated concrete washout area to prevent site runoff and ensure compliance.



                    **2. Demolition & Site Preparation**

                        -   Be Specific: Clearly list all items to be removed, including load-bearing vs. non-load-bearing walls, specific windows/doors, flooring, fixtures, cabinetry, and old MEP (Mechanical, Electrical, Plumbing) systems like furnaces or old wiring.

                        -   Debris Management: Mention the plan for hauling and legal disposal of all construction debris.



                    **3. Foundation & Structural Framing**

                        -   Foundation: Describe all new foundation work, specifying footings, piers, rebar installation, and concrete pouring, referencing structural detail pages (e.g., "as per detail 1/A1").

                        - Structural Basis of Bid (Allowance): Critically, add a clause stating: "As final structural engineering plans are not yet available, this proposal is based on the following specific allowances. Requirements exceeding these allowances will be addressed via change order:

                            - Concrete: Includes standard 12-inch wide by 18-inch deep concrete footings with (2) #4 rebar continuous top and (2) #4 rebar continuous bottom.

                            - Framing: Includes an allowance for up to 16 linear feet of new shear wall and up to two (2) strong walls."

                        -   Construction & Framing: Detail the installation of new structural elements like flush beams or cased openings. Describe framing for all new walls, reconfigured closets, and ceiling structures. Explicitly mention specialty framing for items like pocket doors or shower niches.



                    **4. Exterior Work & Finishes**

                        -   Roofing: If applicable, describe work on roof decking, installation of radiant barriers, waterproofing, and new roofing materials.

                        -   Windows & Exterior Doors: Specify the installation, type, and dimensions of all new windows and doors (e.g., "5'-0" x 6'-8" dual-glaze vinyl sliding door"). Explicitly state: "Bid includes all new windows to be tempered glass as per plan specifications but will be extra cost."



                    **5. Major Systems & Insulation (MEP)**

                        -   Plumbing (P): Detail the full scope, including rough-in with new copper hot/cold supply lines and ABS drains, installation of a new tankless water heater, gas lines, and final installation of all client-provided fixtures (sinks, toilets, faucets, tub, shower valves). Mention insulation of hot/cold water pipes. For the gas system, detail the installation of all new gas lines to appliances (e.g., furnace, water heater, cooktop). Describe the process for system pressure testing, coordinating the official inspection, and securing the final "Gas On" milestone with the utility provider.

                        -   Electrical (E): Describe the main service panel upgrade (e.g., "to 200 Amps"), a full rewire of remodeled areas, dedicated circuits (e.g., "240V/50A for future electric range"), and installation of all new lighting (recessed, under-cabinet LEDs), outlets, switches (including dimmers/vacancy sensors), and safety devices.

                        -   Mechanical / HVAC (M): Detail the removal of old systems and installation of new, high-efficiency systems like a heat pump with ceiling-mounted cassettes. Specify venting for new kitchen range hoods and bathroom exhaust fans to the exterior.

                        -   Insulation: Specify the installation of new insulation, referencing R-values for walls, ceilings, and floors from energy calculation pages (e.g., "R-21 in walls, R-30 in ceilings").



                    **6. Interior Finishes**

                        -   Drywall: Describe installation and finish level (e.g., "smooth (Level 5) finish, ready for paint").

                        -   Painting: Detail the full process: one coat of primer and two finish coats of paint on all interior walls, ceilings, doors, and trim.

                        -   Flooring & Baseboards: Specify the installation of new flooring and baseboards throughout all remodeled areas.

                        -   Kitchen: Detail the installation of new cabinets in the specified layout (e.g., U-shaped), fabrication/installation of countertops (including features like breakfast bars), and installation of tile backsplash.

                        -   Bathrooms: Detail the installation of vanities, countertops, sinks, tile on floors, and tile for shower walls/pans or tub surrounds.

                        -   Doors & Hardware: Specify the installation of all new solid-core interior doors (including sliding/pocket doors), casings, and all associated hardware (handles, hinges, locks).



                    **7. Final Touches & Project Completion**

                        -   Appliance & Accessory Installation: **Explicitly list** the installation of all owner-provided appliances (kitchen and laundry) AND **bathroom accessories** (e.g., mirrors, towel bars, toilet paper holders).

                        -   Final Cleanup: State that the site will be left in a "broom-swept" or "move-in ready" condition.



                

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

            ** If there are multiple rooms of the same type, add their sizes together. **

            - `Zone District`: **Find the zoning code for the property. Look for labels like "ZONE DISTRICT", "ZONING", or "PARCEL ZONING".**

            - `Type of Construction`: **Find the construction classification. Look for labels like "TYPE OF CONSTRUCTION" or "CONSTRUCTION TYPE".**

            - `Occupancy Group`: **Find the occupancy classification code. Look for labels like "OCCUPANCY GROUP", "OCCUPANCY", or "GROUP".**



        Your final output must formatted as a string with markdown headings and bullet points, while the rest of the data remains in a JSON structure.



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
        
        # CHANGE: Look for filePath instead of fileData
        if "filePath" not in data or "userId" not in data:
             return https_fn.Response(json.dumps({"error": "Missing filePath or userId"}), status=400, mimetype="application/json", headers=_cors_headers_for(origin))

        # 1. Download the file from Firebase Storage
        try:
            bucket_name = _get_bucket_name()
            bucket = storage_client.bucket(bucket_name)
            blob = bucket.blob(data["filePath"])
            
            # Download the file content into memory
            raw_bytes = blob.download_as_bytes()
            mime_type = blob.content_type or "application/pdf"
        except Exception as storage_err:
            print(f"Error downloading from storage: {storage_err}")
            return https_fn.Response(json.dumps({"error": "Failed to retrieve file from storage"}), status=500, headers=_cors_headers_for(origin))

        all_analysis_results = []
        first_page_bytes = None
        page_count = 0
        selected_pages_indices = []

        if mime_type.lower() == "application/pdf":
            with fitz.open(stream=raw_bytes, filetype="pdf") as doc:
                page_count = doc.page_count
                
                for i in range(0, page_count, CHUNK_SIZE):
                    chunk_pages = list(range(i, min(i + CHUNK_SIZE, page_count)))
                    content_for_gemini = [prompt]
                    
                    for page_num in chunk_pages:
                        page = doc.load_page(page_num)
                        
                        if first_page_bytes is None:
                            pix = page.get_pixmap(dpi=250)
                            first_page_bytes = pix.tobytes("png")

                        text = page.get_text("text")
                        if len(text) > TEXT_THRESHOLD or page_num == 0:
                            selected_pages_indices.append(page_num)
                            pix = page.get_pixmap(dpi=250)
                            image_bytes = pix.tobytes("png")
                            content_for_gemini.append(Part.from_data(data=image_bytes, mime_type="image/png"))
                    
                    if len(content_for_gemini) > 1: 
                        response = gemini_model.generate_content(content_for_gemini)
                        raw_text = response.text.strip().replace("```json", "").replace("```", "")
                        analysis = json.loads(raw_text)
                        all_analysis_results.append(analysis)

        else:
            page_count = 1
            selected_pages_indices.append(0)
            first_page_bytes = raw_bytes
            content_for_gemini = [prompt, Part.from_data(data=raw_bytes, mime_type=mime_type)]
            
            response = gemini_model.generate_content(content_for_gemini)
            raw_text = response.text.strip().replace("```json", "").replace("```", "")
            analysis = json.loads(raw_text)
            all_analysis_results.append(analysis)

        if not first_page_bytes:
            raise ValueError("No image data could be processed for upload.")
        
        final_analysis = _merge_analysis_results(all_analysis_results)

        # Upload the thumbnail/first page to a permanent location
        bucket_name = _get_bucket_name()
        bucket = storage_client.bucket(bucket_name)
        fname = f"blueprints/{data['userId']}/{uuid.uuid4()}.png"
        blob_thumb = bucket.blob(fname)
        blob_thumb.upload_from_string(first_page_bytes, content_type="image/png")

        # Optional: Clean up the temporary uploaded PDF chunk to save space
        try:
            blob.delete()
        except:
            pass

        response_data = {
            "analysisResult": final_analysis,
            "blueprintUrl": blob_thumb.public_url,
            "selectedPages": selected_pages_indices,
            "totalPages": page_count
        }
        return https_fn.Response(json.dumps(response_data), status=200, mimetype="application/json", headers=_cors_headers_for(origin))

    except Exception as e:
        print(f"Error in analyze_blueprint: {e}")
        return https_fn.Response(json.dumps({"error": str(e)}), status=500, mimetype="application/json", headers=_cors_headers_for(origin))

@https_fn.on_request(memory=4096, timeout_sec=300)
def synthesize_scope_of_work(req: https_fn.Request) -> https_fn.Response:
    """
    Takes multiple 'Scope of Work' texts and synthesizes them into one cohesive document.
    """
    origin = req.headers.get("Origin")

    if req.method == "OPTIONS":
        return https_fn.Response("", status=204, headers=_cors_preflight_headers(origin))

    if req.method != "POST":
        return https_fn.Response("Method Not Allowed", status=405, headers=_cors_headers_for(origin))

    try:
        _initialize_clients()

        data = req.get_json(silent=True)
        if not data or "text" not in data:
            return https_fn.Response(
                json.dumps({"error": "Bad Request: 'text' field not found"}),
                status=400, mimetype="application/json", headers=_cors_headers_for(origin)
            )

        combined_text = data["text"]

        prompt = f"""
        You are an expert construction project manager tasked with synthesizing multiple "Scope of Work" drafts into a single, final, client-ready document. These drafts were generated from different pages of a blueprint and may contain repetitive, disjointed, or contradictory information.

        Your task is to create one cohesive, well-organized, and comprehensive "Scope of Work".

        Follow these steps:
        1.  **Analyze and Consolidate:** Read all provided text fragments. Identify every unique task, material, specification, and construction step mentioned.
        2.  **De-duplicate and Refine:** Eliminate all repetitive information and redundant phrasing. Merge related items into a logical flow. For example, combine all demolition tasks under a single "Demolition" heading.
        3.  **Organize Logically:** Structure the final output according to the standard construction phases provided in the original instructions below. The narrative should flow logically from pre-construction to final cleanup.
        4.  **Resolve and a Flag Contradictions (important):** If you find conflicting information between the drafts (e.g., one draft specifies a '5x4 window' while another specifies a '5x6-8 sliding door' for the same location), consolidate the information and highlight the discrepancy for final review. Use a format like: **"[USER REVIEW NEEDED: Conflicting specifications found for Bedroom 1 opening: 5'x4' sliding window vs. 5'-0" x 6'-8" sliding door]".**
        5.  **Ensure Completeness:** The final output must be a comprehensive, easy-to-understand narrative that walks a homeowner through the entire construction journey.

        **Formatting Rules:**
        -   Do not add any introductory sentences or conversational text.
        -   The output should begin directly with the first heading (e.g., `### 1. Pre-Construction & Project Management`).
        -   Use the original instruction's structure as your template.

        ---
        **Original Instruction Template:**
            **Structure the SOW by Phase:**

                    **1. Pre-Construction & Project Management**
                                -   Permitting & Inspections: Detail the plan to prepare and submit plans, pull all necessary city permits (Building, Electrical, Plumbing, Mechanical), and coordinate all required city inspections from foundation to final.
                                -   Site Logistics: Describe on-site management, and the setup of temporary facilities like construction fencing, portable restrooms, and regular debris disposal schedules. Crucially, detail the implementation and maintenance of the site's Erosion Control plan and Stormwater Pollution Prevention Plan (SWPPP) as required by local authorities. Specify the installation of measures like silt fences, gravel bags at inlets, and a designated concrete washout area to prevent site runoff and ensure compliance.

                    **2. Demolition & Site Preparation**
                        -   Be Specific: Clearly list all items to be removed, including load-bearing vs. non-load-bearing walls, specific windows/doors, flooring, fixtures, cabinetry, and old MEP (Mechanical, Electrical, Plumbing) systems like furnaces or old wiring.
                        -   Debris Management: Mention the plan for hauling and legal disposal of all construction debris.

                    **3. Foundation & Structural Framing**
                        -   Foundation: Describe all new foundation work, specifying footings, piers, rebar installation, and concrete pouring, referencing structural detail pages (e.g., "as per detail 1/A1").
                        - Structural Basis of Bid (Allowance): Critically, add a clause stating: "As final structural engineering plans are not yet available, this proposal is based on the following specific allowances. Requirements exceeding these allowances will be addressed via change order:
                            - Concrete: Includes standard 12-inch wide by 18-inch deep concrete footings with (2) #4 rebar continuous top and (2) #4 rebar continuous bottom.
                            - Framing: Includes an allowance for up to 16 linear feet of new shear wall and up to two (2) strong walls."
                        -   Construction & Framing: Detail the installation of new structural elements like flush beams or cased openings. Describe framing for all new walls, reconfigured closets, and ceiling structures. Explicitly mention specialty framing for items like pocket doors or shower niches.

                    **4. Exterior Work & Finishes**
                        -   Roofing: If applicable, describe work on roof decking, installation of radiant barriers, waterproofing, and new roofing materials.
                        -   Windows & Exterior Doors: Specify the installation, type, and dimensions of all new windows and doors (e.g., "5'-0" x 6'-8" dual-glaze vinyl sliding door"). Explicitly state: "Bid includes all new windows to be tempered glass as per plan specifications but will be extra cost."

                    **5. Major Systems & Insulation (MEP)**
                        -   Plumbing (P): Detail the full scope, including rough-in with new copper hot/cold supply lines and ABS drains, installation of a new tankless water heater, gas lines, and final installation of all client-provided fixtures (sinks, toilets, faucets, tub, shower valves). Mention insulation of hot/cold water pipes. For the gas system, detail the installation of all new gas lines to appliances (e.g., furnace, water heater, cooktop). Describe the process for system pressure testing, coordinating the official inspection, and securing the final "Gas On" milestone with the utility provider.
                        -   Electrical (E): Describe the main service panel upgrade (e.g., "to 200 Amps"), a full rewire of remodeled areas, dedicated circuits (e.g., "240V/50A for future electric range"), and installation of all new lighting (recessed, under-cabinet LEDs), outlets, switches (including dimmers/vacancy sensors), and safety devices.
                        -   Mechanical / HVAC (M): Detail the removal of old systems and installation of new, high-efficiency systems like a heat pump with ceiling-mounted cassettes. Specify venting for new kitchen range hoods and bathroom exhaust fans to the exterior.
                        -   Insulation: Specify the installation of new insulation, referencing R-values for walls, ceilings, and floors from energy calculation pages (e.g., "R-21 in walls, R-30 in ceilings").

                    **6. Interior Finishes**
                        -   Drywall: Describe installation and finish level (e.g., "smooth (Level 5) finish, ready for paint").
                        -   Painting: Detail the full process: one coat of primer and two finish coats of paint on all interior walls, ceilings, doors, and trim.
                        -   Flooring & Baseboards: Specify the installation of new flooring and baseboards throughout all remodeled areas.
                        -   Kitchen: Detail the installation of new cabinets in the specified layout (e.g., U-shaped), fabrication/installation of countertops (including features like breakfast bars), and installation of tile backsplash.
                        -   Bathrooms: Detail the installation of vanities, countertops, sinks, tile on floors, and tile for shower walls/pans or tub surrounds.
                        -   Doors & Hardware: Specify the installation of all new solid-core interior doors (including sliding/pocket doors), casings, and all associated hardware (handles, hinges, locks).

                    **7. Final Touches & Project Completion**
                        -   Appliance & Accessory Installation: **Explicitly list** the installation of all owner-provided appliances (kitchen and laundry) AND **bathroom accessories** (e.g., mirrors, towel bars, toilet paper holders).
                        -   Final Cleanup: State that the site will be left in a "broom-swept" or "move-in ready" condition.


        ---
        **Combined Text to Synthesize:**
        {combined_text}
        ---
        """

        synthesis_model = GenerativeModel("gemini-2.5-pro")
        response = synthesis_model.generate_content(prompt)
        synthesized_text = response.text.strip()

        return https_fn.Response(
            json.dumps({"synthesizedScope": synthesized_text}),
            status=200, mimetype="application/json", headers=_cors_headers_for(origin)
        )

    except Exception as e:
        print(f"Error in synthesize_scope_of_work: {e}")
        return https_fn.Response(
            json.dumps({"error": str(e)}),
            status=500, mimetype="application/json", headers=_cors_headers_for(origin)
        )

@https_fn.on_request(memory=8192, timeout_sec=1800)
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
        
        sample_rate = data["sampleRate"]

        # Decode the data URI and capture the original mime
        audio_content, mime_type = _decode_data_uri(data["audioData"])
        if not audio_content:
            return https_fn.Response(
                json.dumps({"error": "Bad Request: Audio data is empty"}),
                status=400, mimetype="application/json", headers=_cors_headers_for(origin)
            )

        # Inspect the incoming mime; many browsers give variants like:
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
            explicit_config = speech_v2.ExplicitDecodingConfig(
                encoding=decoding_encoding,
                sample_rate_hertz=sample_rate,          
                audio_channel_count=channel_count   
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
            raise ValueError(
                "Transcription completed but returned no text. "
                "Possible causes: near-silence/very short audio, wrong sample_rate_hertz, or a codec/container mismatch."
            )

        # Loop through all results and join them to form the full transcript
        transcript_parts = []
        for result in file_result.transcript.results:
            if result.alternatives:
                transcript_parts.append(result.alternatives[0].transcript)
        
        transcript = "".join(transcript_parts).strip()

        if not transcript:
             raise ValueError("No alternatives returned.")
        
        print(f"[analyze_voice_recording] Transcript length: {len(transcript)}")

        # 3) Clean up temporary audio file
        try:
            audio_blob.delete()
        except Exception as _:
            pass

        # --- Gemini analysis prompt ---
        prompt = f"""
        Analyze the following transcribed text from a client meeting. Your task is to: 
        1. extract key project details into a JSON format. 

        2. analyze all provided transcribed text to generate a clear "Scope of Work". After that, fill in any other details you can find.

        Follow these instructions carefully for each key:

        1.  **Top-Level Keys:**
    * `Project Name`: **Find the project's title, often the first line of the project description.**
    * `Project Description`: **Provide a concise summary of the project's main objectives (e.g., complete interior remodel, kitchen and bath renovation, creating a new bathroom, etc.).**
    * `Project Address`: **Find the physical address of the job site.**
    * `Client Name`: **Find the name of the property owner or client.**
    * `Scope of Work`: **This is the most critical section. Write a formal, narrative-style Scope of Work for a homeowner. Use all blueprint pages (Architectural, Structural, MEP, etc.) to create a thorough, step-by-step description. Cross-reference all pages to ensure consistency and capture all details.**

        **Expert Analysis & Detail Inference:**
        * **Go Beyond the Obvious:** Do not just list what you see. Infer standard construction practices. For example, if you see a new shower, include the installation of a waterproof membrane, a custom shower pan, and tile backer board. If there's a new kitchen, mention under-cabinet lighting.
        * **Identify High-Quality Features:** Look for notes that imply a higher standard of work, such as "Level 5 smooth finish", "solid-core doors", "dimmer switches", or specific material types like "copper supply lines".
        * **Consider Future Needs & Codes:** As seen in the best examples, include forward-thinking details like installing "2x8 blocking in walls for future grab bar installation" in bathrooms, which is a best practice. Mention code requirements like "tamper-resistant outlets" or "GFCI protection" where applicable.

            **Structure the SOW by Phase:**

                    **1. Pre-Construction & Project Management**
                                -   Permitting & Inspections: Detail the plan to prepare and submit plans, pull all necessary city permits (Building, Electrical, Plumbing, Mechanical), and coordinate all required city inspections from foundation to final.
                                -   Site Logistics: Describe on-site management, and the setup of temporary facilities like construction fencing, portable restrooms, and regular debris disposal schedules. Crucially, detail the implementation and maintenance of the site's Erosion Control plan and Stormwater Pollution Prevention Plan (SWPPP) as required by local authorities. Specify the installation of measures like silt fences, gravel bags at inlets, and a designated concrete washout area to prevent site runoff and ensure compliance.

                    **2. Demolition & Site Preparation**
                        -   Be Specific: Clearly list all items to be removed, including load-bearing vs. non-load-bearing walls, specific windows/doors, flooring, fixtures, cabinetry, and old MEP (Mechanical, Electrical, Plumbing) systems like furnaces or old wiring.
                        -   Debris Management: Mention the plan for hauling and legal disposal of all construction debris.

                    **3. Foundation & Structural Framing**
                        -   Foundation: Describe all new foundation work, specifying footings, piers, rebar installation, and concrete pouring, referencing structural detail pages (e.g., "as per detail 1/A1").
                        - Structural Basis of Bid (Allowance): Critically, add a clause stating: "As final structural engineering plans are not yet available, this proposal is based on the following specific allowances. Requirements exceeding these allowances will be addressed via change order:
                            - Concrete: Includes standard 12-inch wide by 18-inch deep concrete footings with (2) #4 rebar continuous top and (2) #4 rebar continuous bottom.
                            - Framing: Includes an allowance for up to 16 linear feet of new shear wall and up to two (2) strong walls."
                        -   Construction & Framing: Detail the installation of new structural elements like flush beams or cased openings. Describe framing for all new walls, reconfigured closets, and ceiling structures. Explicitly mention specialty framing for items like pocket doors or shower niches.

                    **4. Exterior Work & Finishes**
                        -   Roofing: If applicable, describe work on roof decking, installation of radiant barriers, waterproofing, and new roofing materials.
                        -   Windows & Exterior Doors: Specify the installation, type, and dimensions of all new windows and doors (e.g., "5'-0" x 6'-8" dual-glaze vinyl sliding door"). Explicitly state: "Bid includes all new windows to be tempered glass as per plan specifications but will be extra cost."

                    **5. Major Systems & Insulation (MEP)**
                        -   Plumbing (P): Detail the full scope, including rough-in with new copper hot/cold supply lines and ABS drains, installation of a new tankless water heater, gas lines, and final installation of all client-provided fixtures (sinks, toilets, faucets, tub, shower valves). Mention insulation of hot/cold water pipes. For the gas system, detail the installation of all new gas lines to appliances (e.g., furnace, water heater, cooktop). Describe the process for system pressure testing, coordinating the official inspection, and securing the final "Gas On" milestone with the utility provider.
                        -   Electrical (E): Describe the main service panel upgrade (e.g., "to 200 Amps"), a full rewire of remodeled areas, dedicated circuits (e.g., "240V/50A for future electric range"), and installation of all new lighting (recessed, under-cabinet LEDs), outlets, switches (including dimmers/vacancy sensors), and safety devices.
                        -   Mechanical / HVAC (M): Detail the removal of old systems and installation of new, high-efficiency systems like a heat pump with ceiling-mounted cassettes. Specify venting for new kitchen range hoods and bathroom exhaust fans to the exterior.
                        -   Insulation: Specify the installation of new insulation, referencing R-values for walls, ceilings, and floors from energy calculation pages (e.g., "R-21 in walls, R-30 in ceilings").

                    **6. Interior Finishes**
                        -   Drywall: Describe installation and finish level (e.g., "smooth (Level 5) finish, ready for paint").
                        -   Painting: Detail the full process: one coat of primer and two finish coats of paint on all interior walls, ceilings, doors, and trim.
                        -   Flooring & Baseboards: Specify the installation of new flooring and baseboards throughout all remodeled areas.
                        -   Kitchen: Detail the installation of new cabinets in the specified layout (e.g., U-shaped), fabrication/installation of countertops (including features like breakfast bars), and installation of tile backsplash.
                        -   Bathrooms: Detail the installation of vanities, countertops, sinks, tile on floors, and tile for shower walls/pans or tub surrounds.
                        -   Doors & Hardware: Specify the installation of all new solid-core interior doors (including sliding/pocket doors), casings, and all associated hardware (handles, hinges, locks).

                    **7. Final Touches & Project Completion**
                        -   Appliance & Accessory Installation: **Explicitly list** the installation of all owner-provided appliances (kitchen and laundry) AND **bathroom accessories** (e.g., mirrors, towel bars, toilet paper holders).
                        -   Final Cleanup: State that the site will be left in a "broom-swept" or "move-in ready" condition.
                
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
            ** If there are multiple rooms of the same type, add their sizes together. **
            - `Zone District`: **Find the zoning code for the property. Look for labels like "ZONE DISTRICT", "ZONING", or "PARCEL ZONING".**
            - `Type of Construction`: **Find the construction classification. Look for labels like "TYPE OF CONSTRUCTION" or "CONSTRUCTION TYPE".**
            - `Occupancy Group`: **Find the occupancy classification code. Look for labels like "OCCUPANCY GROUP", "OCCUPANCY", or "GROUP".**

        Your final output must formatted as a string with markdown headings and bullet points, while the rest of the data remains in a JSON structure.

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


@https_fn.on_request(memory=2048, timeout_sec=300)
def generate_scope_of_work(req: https_fn.Request) -> https_fn.Response:
    """Generates a scope of work based on line items."""
    origin = req.headers.get("Origin")

    if req.method == "OPTIONS":
        return https_fn.Response("", status=204, headers=_cors_preflight_headers(origin))

    if req.method != "POST":
        return https_fn.Response("Method Not Allowed", status=405, headers=_cors_headers_for(origin))

    try:
        _initialize_clients()

        data = req.get_json(silent=True)
        if not data or "items" not in data:
            return https_fn.Response(json.dumps({"error": "Bad Request: 'items' not found"}),
                                     status=400, mimetype="application/json", headers=_cors_headers_for(origin))

        items = data["items"]

        # Create a detailed prompt for the AI
        prompt = """
        You are an expert construction project manager. Based on the following list of items and their square footage, generate a detailed, well-formatted Scope of Work suitable for a client proposal. Structure the output by area or room. For each location, use clear headings (e.g., Kitchen Remodel, Full Gut) and detail the following in plain language where applicable:
        
        * `Scope of Work`: **Act as a project manager writing a formal Scope of Work for a homeowner. Using all provided blueprint pages, create a thorough, step-by-step detail description of the entire project. Structure the output by area or room. For each location, use clear headings (e.g., Kitchen Remodel, Second Floor Addition, Exterior Work) and detail the following in plain language:

                    **1. Pre-Construction & Project Management**
                                -   Permitting & Inspections: Detail the plan to prepare and submit plans, pull all necessary city permits (Building, Electrical, Plumbing, Mechanical), and coordinate all required city inspections from foundation to final.
                                -   Site Logistics: Describe on-site management, and the setup of temporary facilities like construction fencing, portable restrooms, and regular debris disposal schedules. Crucially, detail the implementation and maintenance of the site's Erosion Control plan and Stormwater Pollution Prevention Plan (SWPPP) as required by local authorities. Specify the installation of measures like silt fences, gravel bags at inlets, and a designated concrete washout area to prevent site runoff and ensure compliance.

                    **2. Demolition & Site Preparation**
                        -   Be Specific: Clearly list all items to be removed, including load-bearing vs. non-load-bearing walls, specific windows/doors, flooring, fixtures, cabinetry, and old MEP (Mechanical, Electrical, Plumbing) systems like furnaces or old wiring.
                        -   Debris Management: Mention the plan for hauling and legal disposal of all construction debris.

                    **3. Foundation & Structural Framing**
                        -   Foundation: Describe all new foundation work, specifying footings, piers, rebar installation, and concrete pouring, referencing structural detail pages (e.g., "as per detail 1/A1").
                        - Structural Basis of Bid (Allowance): Critically, add a clause stating: "As final structural engineering plans are not yet available, this proposal is based on the following specific allowances. Requirements exceeding these allowances will be addressed via change order:
                            - Concrete: Includes standard 12-inch wide by 18-inch deep concrete footings with (2) #4 rebar continuous top and (2) #4 rebar continuous bottom.
                            - Framing: Includes an allowance for up to 16 linear feet of new shear wall and up to two (2) strong walls."
                        -   Construction & Framing: Detail the installation of new structural elements like flush beams or cased openings. Describe framing for all new walls, reconfigured closets, and ceiling structures. Explicitly mention specialty framing for items like pocket doors or shower niches.

                    **4. Exterior Work & Finishes**
                        -   Roofing: If applicable, describe work on roof decking, installation of radiant barriers, waterproofing, and new roofing materials.
                        -   Windows & Exterior Doors: Specify the installation, type, and dimensions of all new windows and doors (e.g., "5'-0" x 6'-8" dual-glaze vinyl sliding door"). Explicitly state: "Bid includes all new windows to be tempered glass as per plan specifications but will be extra cost."

                    **5. Major Systems & Insulation (MEP)**
                        -   Plumbing (P): Detail the full scope, including rough-in with new copper hot/cold supply lines and ABS drains, installation of a new tankless water heater, gas lines, and final installation of all client-provided fixtures (sinks, toilets, faucets, tub, shower valves). Mention insulation of hot/cold water pipes. For the gas system, detail the installation of all new gas lines to appliances (e.g., furnace, water heater, cooktop). Describe the process for system pressure testing, coordinating the official inspection, and securing the final "Gas On" milestone with the utility provider.
                        -   Electrical (E): Describe the main service panel upgrade (e.g., "to 200 Amps"), a full rewire of remodeled areas, dedicated circuits (e.g., "240V/50A for future electric range"), and installation of all new lighting (recessed, under-cabinet LEDs), outlets, switches (including dimmers/vacancy sensors), and safety devices.
                        -   Mechanical / HVAC (M): Detail the removal of old systems and installation of new, high-efficiency systems like a heat pump with ceiling-mounted cassettes. Specify venting for new kitchen range hoods and bathroom exhaust fans to the exterior.
                        -   Insulation: Specify the installation of new insulation, referencing R-values for walls, ceilings, and floors from energy calculation pages (e.g., "R-21 in walls, R-30 in ceilings").

                    **6. Interior Finishes**
                        -   Drywall: Describe installation and finish level (e.g., "smooth (Level 5) finish, ready for paint").
                        -   Painting: Detail the full process: one coat of primer and two finish coats of paint on all interior walls, ceilings, doors, and trim.
                        -   Flooring & Baseboards: Specify the installation of new flooring and baseboards throughout all remodeled areas.
                        -   Kitchen: Detail the installation of new cabinets in the specified layout (e.g., U-shaped), fabrication/installation of countertops (including features like breakfast bars), and installation of tile backsplash.
                        -   Bathrooms: Detail the installation of vanities, countertops, sinks, tile on floors, and tile for shower walls/pans or tub surrounds.
                        -   Doors & Hardware: Specify the installation of all new solid-core interior doors (including sliding/pocket doors), casings, and all associated hardware (handles, hinges, locks).

                    **7. Final Touches & Project Completion**
                        -   Appliance & Accessory Installation: **Explicitly list** the installation of all owner-provided appliances (kitchen and laundry) AND **bathroom accessories** (e.g., mirrors, towel bars, toilet paper holders).
                        -   Final Cleanup: State that the site will be left in a "broom-swept" or "move-in ready" condition.
                
                - Ensure the final text is a comprehensive narrative that walks the homeowner through the entire construction journey from start to finish.**

        **IMPORTANT:** Your response must ONLY be the Scope of Work text. Do not include any introductory sentences, conversational text, or any text other than the scope of work itself. The output should begin directly with the first heading.
        """

        # Append the items from the request to the prompt
        for item in items:
            if item.get("type") and item.get("sf"):
                prompt += f"\n- **{item['type']}**: {item['sf']} sq ft"

        # Call the Gemini API
        response = gemini_model.generate_content(prompt)
        
        # Extract the generated text
        scope_of_work = response.text.strip()

        return https_fn.Response(json.dumps({"scopeOfWork": scope_of_work}),
                                 status=200, mimetype="application/json", headers=_cors_headers_for(origin))

    except Exception as e:
        print(f"Error in generate_scope_of_work: {e}")
        return https_fn.Response(json.dumps({"error": str(e)}),
                                 status=500, mimetype="application/json", headers=_cors_headers_for(origin))
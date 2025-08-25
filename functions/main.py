# Final deployment attempt - 2025-08-25-1310
import base64
import json
import os
import firebase_admin
from firebase_admin import credentials, firestore
from firebase_functions import https_fn
from google.cloud import storage
from vertexai import generative_models
import fitz  # PyMuPDF library for PDF processing

# Initialize Firebase Admin SDK.
firebase_admin.initialize_app()

@https_fn.on_request(
    memory=512
)
def analyze_blueprint(req: https_fn.Request) -> https_fn.Response:
    """
    An HTTP function that analyzes a blueprint and handles CORS manually.
    """
    # Set CORS headers for the preflight request
    if req.method == "OPTIONS":
        headers = {
            "Access-Control-Allow-Origin": "*", # Or be more specific with your domains
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "3600",
        }
        return https_fn.Response("", status=204, headers=headers)

    # Set CORS headers for the main request
    headers = {
        "Access-Control-Allow-Origin": "*" # Or be more specific with your domains
    }

    # LAZY INITIALIZATION
    db = firestore.client()
    storage_client = storage.Client()
    model = generative_models.GenerativeModel("gemini-pro-vision")
    
    if req.method != "POST":
        return https_fn.Response("Method not allowed", status=405, headers=headers)

    try:
        request_data = req.get_json()
        
        required_fields = ["fileData", "projectName", "address", "clientName", "userId"]
        if not all(field in request_data for field in required_fields):
            return https_fn.Response("Missing required fields", status=400, headers=headers)
        
        file_data_base64 = request_data["fileData"]
        project_name = request_data["projectName"]
        address = request_data["address"]
        client_name = request_data["clientName"]
        user_id = request_data["userId"]

        image_data = None
        mime_type = "image/png"

        if "data:application/pdf" in file_data_base64:
            pdf_bytes = base64.b64decode(file_data_base64.split(",")[1])
            pdf_document = fitz.open(stream=pdf_bytes, filetype="pdf")
            first_page = pdf_document.load_page(0)
            pix = first_page.get_pixmap(dpi=150)
            image_data = pix.tobytes("png")
            pdf_document.close()
        else:
            image_data = base64.b64decode(file_data_base64.split(",")[1])

        bucket_name = f"{os.environ.get('GCP_PROJECT')}.appspot.com"
        bucket = storage_client.bucket(bucket_name)
        file_name = f"blueprints/{user_id}/{project_name}_{db.collection('projects').document().id}.png"
        blob = bucket.blob(file_name)
        
        blob.upload_from_string(image_data, content_type=mime_type)
        blueprint_url = blob.public_url

        image_part = generative_models.Part.from_data(data=image_data, mime_type=mime_type)
        
        text_part = """
        Analyze this blueprint image. Your task is to identify and calculate the square footage for each distinct room or area.
        You must only provide the following room types: 'Full gut'(meaning it's a whole remodeling), 'Additional building', 'Structural Wall removeal', '2nd Structural Wall removeal','Kitchen', 'Bathroom', 'Living room', 'Bedroom', 'Garage'. 
        If no square footage is listed, provide a value of 0.
        Format your response as a JSON object with keys corresponding to the room types and numerical values for the square footage.
        Do not include any other text, explanation, or conversational phrases.

        Example of desired output:
        ```json
        {
          "Kitchen": 250,
          "Bathroom": 75,
          "Living room": 400
        }
        ```
        """
        
        contents = [image_part, text_part]
        response = model.generate_content(contents)
        
        analysis_data = {}
        try:
            cleaned_text = response.text.strip().replace("```json", "").replace("```", "").strip()
            analysis_data = json.loads(cleaned_text)
        except (json.JSONDecodeError, AttributeError):
            analysis_data = {"error": "Failed to parse analysis from model response."}

        project_data = {
            "userId": user_id,
            "projectName": project_name,
            "address": address,
            "clientName": client_name,
            "blueprintUrl": blueprint_url,
            "analysisResult": analysis_data,
            "createdAt": firestore.SERVER_TIMESTAMP
        }
        
        db.collection("projects").add(project_data)

        return https_fn.Response(json.dumps({
            "message": "Analysis successful and data saved!",
            "analysisResult": analysis_data
        }), status=200, mimetype="application/json", headers=headers)

    except Exception as e:
        print(f"Error: {e}")
        return https_fn.Response(json.dumps({
            "error": "Failed to analyze blueprint",
            "details": str(e)
        }), status=500, mimetype="application/json", headers=headers)

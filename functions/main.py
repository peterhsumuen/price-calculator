# Forcing a final update attampt on 2025-08-25
import base64
import json
import os
import firebase_admin
from firebase_admin import credentials, firestore
from firebase_functions import https_fn
from google.cloud import storage
from vertexai import generative_models
import fitz  # PyMuPDF library for PDF processing

# Initialize Firebase Admin SDK. It's safe to do this once globally.
firebase_admin.initialize_app()

@https_fn.on_request(cors=["http://localhost:3000", "https://remodelingbid.firebaseapp.com", "https://peterhsumuen.github.io"],
                     memory=512)
def analyze_blueprint(req: https_fn.Request) -> https_fn.Response:
    """
    An HTTP function that analyzes a blueprint image (PNG, JPG, or PDF) 
    using the Gemini API and saves the results.
    """
    
    # LAZY INITIALIZATION: Create clients inside the function.
    db = firestore.client()
    storage_client = storage.Client()
    model = generative_models.GenerativeModel("gemini-pro-vision")
    
    if req.method != "POST":
        return https_fn.Response("Method not allowed", status=405)

    try:
        request_data = req.get_json()
        
        required_fields = ["fileData", "projectName", "address", "clientName", "userId"]
        if not all(field in request_data for field in required_fields):
            return https_fn.Response("Missing required fields", status=400)
        
        file_data_base64 = request_data["fileData"]
        project_name = request_data["projectName"]
        address = request_data["address"]
        client_name = request_data["clientName"]
        user_id = request_data["userId"]

        image_data = None
        mime_type = "image/png" # Default to PNG, as PDFs will be converted to PNG

        # Check if the uploaded file is a PDF and convert it
        if "data:application/pdf" in file_data_base64:
            pdf_bytes = base64.b64decode(file_data_base64.split(",")[1])
            pdf_document = fitz.open(stream=pdf_bytes, filetype="pdf")
            first_page = pdf_document.load_page(0)  # Get the first page
            pix = first_page.get_pixmap(dpi=150) # Render page to an image at 150 DPI
            image_data = pix.tobytes("png") # Get the image data in PNG format
            pdf_document.close()
        else:
            # If not a PDF, it's already an image (PNG or JPG)
            image_data = base64.b64decode(file_data_base64.split(",")[1])

        # 1. Upload the (potentially converted) image to Firebase Storage
        bucket_name = f"{os.environ.get('GCP_PROJECT')}.appspot.com"
        bucket = storage_client.bucket(bucket_name)
        file_name = f"blueprints/{user_id}/{project_name}_{db.collection('projects').document().id}.png"
        blob = bucket.blob(file_name)
        
        blob.upload_from_string(image_data, content_type=mime_type)
        blueprint_url = blob.public_url

        # 2. Analyze the image with the Gemini API
        image_part = generative_models.Part.from_data(
            data=image_data,
            mime_type=mime_type
        )
        
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

        # 3. Save the project and analysis results to Firestore
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

        # 4. Return a success response
        return https_fn.Response(json.dumps({
            "message": "Analysis successful and data saved!",
            "analysisResult": analysis_data
        }), status=200, mimetype="application/json")

    except Exception as e:
        print(f"Error: {e}")
        return https_fn.Response(json.dumps({
            "error": "Failed to analyze blueprint",
            "details": str(e)
        }), status=500, mimetype="application/json")



# remember to update the "const functionUrl" in App.js after changes are made and deploy
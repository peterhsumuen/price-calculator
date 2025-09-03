# Price Calculator

This is a web application designed for construction project estimation and management. It provides tools for calculating project costs, storing project records, and leveraging AI-powered analysis of blueprints and voice recordings to streamline the estimation process.

## Features

* **Price Calculator**: A dynamic calculator to estimate project costs. Users can add multiple line items, specify the type of work (e.g., "Full gut", "Kitchen", "Bathroom"), and input the square footage to get a real-time price estimate.
* **Project Records**: All saved projects are stored in a database and can be viewed on the "Records" page. Users can view the details of each project, including the scope of work, itemized list, and final price. There are also options to modify or delete existing projects.
* **Blueprint Analyzer**: This feature allows users to upload a blueprint file (PNG, JPG, or PDF). The application then uses an AI model to analyze the blueprint and automatically extract key information such as project name, address, client name, and the square footage of different areas. This extracted data can then be used to pre-fill the price calculator.
* **Voice Analyzer**: Users can record their voice directly in the application. The recorded audio is then transcribed and analyzed by an AI model to extract project details, which can be used to populate the price calculator.
* **Authentication**: The application uses Firebase for user authentication, ensuring that each user's project data is secure and private.

## Tech Stack

* **Frontend**: React.js
* **Backend**: Firebase (Authentication, Firestore Database, Cloud Functions)
* **AI/ML**: Google Cloud AI Platform (for blueprint and voice analysis)



### `npm start`
for testing on local

### `npm run deploy`
for deploy on github page

### `firebase deploy --only functions`
for deploy main.py on firebase function
make sure to check the Function URL match on App.js

### `python -m pip install -r requirements.txt`
for installing the requirements

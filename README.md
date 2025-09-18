# AuraBid: Your AI Co-pilot for Construction Bidding

AuraBid is a web application designed to streamline the construction project estimation and management process. Go from blueprint to bid in minutes with powerful tools for blueprint and voice analysis, ensuring unparalleled accuracy for your next project.

## About The Project

This tool was built to solve the time-consuming and often inaccurate process of construction bidding. AuraBid provides a suite of tools that leverage AI to automate and enhance project estimation, helping you create more accurate bids in a fraction of the time.

This application consists of three main parts: a dynamic price calculator, a blueprint analyzer, and a voice analyzer. These tools work together to provide a seamless workflow from initial project analysis to final bid creation. All project records are securely stored and can be easily accessed, modified, or deleted.

## Features

* **Dynamic Price Calculator**: Estimate project costs with ease.
    * Add and remove line items for different job types (e.g., "Full Gut," "Kitchen Remodel").
    * Input square footage to get real-time price estimates based on predefined pricing rules.
    * Save, view, modify, and delete project records.
* **Blueprint Analyzer**: Upload blueprint files (PNG, JPG, or PDF) and let our AI extract key details.
    * Automatically extracts project name, address, client name, and square footage of different areas.
    * Pre-fills the price calculator with the extracted data.
* **Voice Analyzer**: Record your voice directly in the app.
    * Our AI will transcribe and analyze the audio to populate project details in the price calculator.
    * Streamlines your workflow by allowing you to dictate project details on the go.
* **Authentication**: Secure user authentication powered by Firebase ensures that your project data is private and protected.

## Technical Deep Dive

AuraBid is a full-stack application built with a modern tech stack:

* **Frontend**: The user interface is built with **React.js** and styled with **DaisyUI** and **Tailwind CSS**. This provides a responsive and intuitive user experience.
* **Backend**: The backend is powered by **Firebase**, which provides a suite of services including:
    * **Firebase Authentication**: For secure user login and data protection.
    * **Firestore Database**: A NoSQL database for storing project records.
    * **Cloud Functions**: Serverless functions that handle the AI-powered analysis of blueprints and voice recordings.
* **AI/ML**: The AI-powered features are built on top of **Google Cloud AI Platform**:
    * The **Blueprint Analyzer** uses a custom AI model to analyze uploaded images and PDFs, extracting key project details.
    * The **Voice Analyzer** uses Google's speech-to-text and natural language processing capabilities to transcribe and analyze voice recordings.

## Getting Started

To get a local copy up and running, follow these simple steps.

### Prerequisites

* npm
    ```sh
    npm install npm@latest -g
    ```

### Installation

1.  Clone the repo
    ```sh
    git clone [https://github.com/peterhsumuen/price-calculator.git](https://github.com/peterhsumuen/price-calculator.git)
    ```
2.  Install NPM packages
    ```sh
    npm install
    ```
3.  Enter your API in a `.env` file in the root of your project
    ```js
    REACT_APP_FIREBASE_API_KEY = 'ENTER YOUR API';
    REACT_APP_FIREBASE_AUTH_DOMAIN = 'ENTER YOUR API';
    REACT_APP_FIREBASE_PROJECT_ID = 'ENTER YOUR API';
    REACT_APP_FIREBASE_STORAGE_BUCKET = 'ENTER YOUR API';
    REACT_APP_FIREBASE_MESSAGING_SENDER_ID = 'ENTER YOUR API';
    REACT_APP_FIREBASE_APP_ID = 'ENTER YOUR API';
    ```

## Usage

* To run the app in the development mode, use `npm start`.
* To build the app for production, use `npm run build`.

## Deployment

This app is deployed on GitHub Pages. To deploy your own version, you can use the `gh-pages` package:

```sh
npm run deploy
```

The Firebase functions are deployed separately:
`firebase deploy --only functions`


### `npm start`
for testing on local

### `npm run deploy`
for deploy on github page

### `firebase deploy --only functions`
for deploy main.py on firebase function
make sure to check the Function URL match on App.js

### `python -m pip install -r requirements.txt`
for installing the requirements

import React from 'react';
import SpotlightCard from './SpotlightCard';

function LearnMorePage({ onBack }) {
  return (
    <div className="min-h-screen bg-[#111827] flex flex-col items-center justify-center p-8 text-white">
      <h1 className="text-5xl md:text-6xl font-bold mb-12 text-center">
        Key Features
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl w-full">
        <SpotlightCard spotlightColor="rgba(0, 229, 255, 0.2)">
          <div className="p-4 text-center">
            <h2 className="text-2xl font-bold mb-4">Price Calculator</h2>
            <p>
              Dynamically estimate project costs with customizable line items. Input square footage for various job types like "Full Gut" or "Kitchen Remodel" to get instant, accurate pricing.
            </p>
          </div>
        </SpotlightCard>

        <SpotlightCard spotlightColor="rgba(255, 0, 229, 0.2)">
          <div className="p-4 text-center">
            <h2 className="text-2xl font-bold mb-4">Blueprint Analyzer</h2>
            <p>
              Upload blueprint files (PNG, JPG, or PDF) and let our AI extract key details like project name, address, and area sizes to auto-fill the calculator.
            </p>
          </div>
        </SpotlightCard>

        <SpotlightCard spotlightColor="rgba(229, 255, 0, 0.2)">
          <div className="p-4 text-center">
            <h2 className="text-2xl font-bold mb-4">Voice Analyzer</h2>
            <p>
              Record your voice directly in the app. Our AI will transcribe and analyze the audio to populate project details in the price calculator, streamlining your workflow.
            </p>
          </div>
        </SpotlightCard>
      </div>

      {/* This button will now be visible */}
      <button
        onClick={onBack}
        className="btn btn-outline btn-lg mt-12 text-white" 
      >
        Back
      </button>
    </div>
  );
}

export default LearnMorePage;
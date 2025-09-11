import React from 'react';
import SpotlightCard from './SpotlightCard';
import DecryptedText from './DecryptedText'; 

function LearnMorePage({ onBack }) {
  return (
    <div className="min-h-screen bg-[#111827] flex flex-col items-center justify-center p-8 text-white">
      <h1 className="text-5xl md:text-6xl font-bold mb-12 text-center">
        <DecryptedText text="Key Features" animateOn="view" sequential speed={50} />
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl w-full">
        {/* Price Calculator Card */}
        <SpotlightCard spotlightColor="rgba(0, 229, 255, 0.2)">
          <div className="flex flex-col h-full">
            <div className="mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-2">Price Calculator</h2>
            <p className="text-gray-300">
              <DecryptedText 
                text={`Dynamically estimate project costs with customizable line items. Input square footage for various job types like "Full Gut" or "Kitchen Remodel" to get instant, accurate pricing.`} 
                animateOn="view" 
                sequential 
                speed={15} 
              />
            </p>
          </div>
        </SpotlightCard>

        {/* Blueprint Analyzer Card */}
        <SpotlightCard spotlightColor="rgba(255, 0, 229, 0.2)">
          <div className="flex flex-col h-full">
            <div className="mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-2">Blueprint Analyzer</h2>
            <p className="text-gray-300">
              <DecryptedText 
                text={`Upload blueprint files (PNG, JPG, or PDF) and let our AI extract key details like project name, address, and area sizes to auto-fill the calculator.`}
                animateOn="view" 
                sequential 
                speed={25} 
              />
            </p>
          </div>
        </SpotlightCard>

        {/* Voice Analyzer Card */}
        <SpotlightCard spotlightColor="rgba(229, 255, 0, 0.2)">
          <div className="flex flex-col h-full">
            <div className="mb-4">
               <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-2">Voice Analyzer</h2>
            <p className="text-gray-300">
              <DecryptedText 
                text={`Record your voice directly in the app. Our AI will transcribe and analyze the audio to populate project details in the price calculator, streamlining your workflow.`}
                animateOn="view" 
                sequential 
                speed={25} 
              />
            </p>
          </div>
        </SpotlightCard>
      </div>

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
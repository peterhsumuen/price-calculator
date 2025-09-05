import React from 'react';
import Orb from './Orb';
import './App.css'; 

function WelcomePage({ onGetStarted }) {
  return (
    <div className="relative w-screen h-screen flex flex-col items-center justify-center bg-gray-900 text-white overflow-hidden">
      {/* Orb Background */}
      <div className="absolute inset-0 z-0">
        <Orb
          hoverIntensity={0.5}
          rotateOnHover={true}
          hue={220} // Adjusted for a blue/purple theme
          forceHoverState={false}
        />
      </div>

      {/* Content Overlay */}
      <div className="relative z-10 flex flex-col items-center text-center p-8">
        <h1 className="text-5xl md:text-7xl font-bold mb-4">
          Construction Price Calculator
        </h1>
        <p className="text-lg md:text-xl mb-8 max-w-2xl">
          Streamline your project estimation with powerful AI-driven tools for blueprint and voice analysis.
        </p>
        <button
          onClick={onGetStarted}
          className="btn btn-primary btn-lg"
        >
          Get Started
        </button>
      </div>
    </div>
  );
}

export default WelcomePage;
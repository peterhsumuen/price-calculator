import React from 'react';
import Orb from './Orb';
import ShinyText from './ShinyText'; // Import the new component
import './App.css'; 

function WelcomePage({ onGetStarted, onLearnMore }) {
  return (
    <div className="relative w-screen h-screen flex flex-col items-center justify-center text-white overflow-hidden">
      {/* Orb Background */}
      <div className="absolute inset-0 z-0">
        <Orb
          hoverIntensity={0.1}
          rotateOnHover={true}
          hue={220}
          forceHoverState={false}
        />
      </div>

      {/* Content Overlay */}
      <div className="relative z-10 flex flex-col items-center text-center p-8">
        <h1 className="text-5xl md:text-7xl font-bold mb-4">
          {/* Replace the plain text with the ShinyText component */}
          <ShinyText text="AuraBid" speed={4} />
        </h1>
        <p className="text-lg md:text-xl mb-8 max-w-2xl text-[#c5c4c4a4]">
          Your AI co-pilot for construction bidding. Go from blueprint to bid in minutes with powerful tools for blueprint and voice analysis, ensuring unparalleled accuracy for your next project.
        </p>
        <div className="flex gap-4">
          <button
            onClick={onGetStarted}
            className="btn btn-primary btn-lg"
          >
            Get Started
          </button>
          <button
            onClick={onLearnMore}
            className="btn btn-secondary btn-outline btn-lg"
          >
            Learn More
          </button>
        </div>
      </div>
    </div>
  );
}

export default WelcomePage;
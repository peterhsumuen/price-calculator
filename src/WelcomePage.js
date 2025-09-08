import React from 'react';
import Orb from './Orb';
import ShinyText from './ShinyText';
import GradientText from './GradientText';
import StarBorder from './StarBorder';
import './App.css'; 

function WelcomePage({ onGetStarted, onLearnMore }) { // Add onLearnMore here
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
          <ShinyText text="AuraBid" speed={4} />
        </h1>

        <div className="text-lg md:text-xl mb-8 max-w-2xl">
          <GradientText showBorder={true}>
            <span className="inline-block p-4">
              Your AI co-pilot for construction bidding. Go from blueprint to bid in minutes with powerful tools for blueprint and voice analysis, ensuring unparalleled accuracy for your next project.
            </span>
          </GradientText>
        </div>

        <div className="flex gap-4">
          {/* Replace the original button with the StarBorder component */}
          <StarBorder
            onClick={onGetStarted}
            className="btn btn-primary btn-lg"
            speed="4.5s"
            thickness={1.5}
            color="white"
          >
            Get Started
          </StarBorder>

          <button
            onClick={onLearnMore} // Use the new prop here
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
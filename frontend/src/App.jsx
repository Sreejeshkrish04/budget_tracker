import React from 'react';
import Dashboard from './components/Dashboard';

function App() {
  return (
    <div className="min-h-screen">
      {/* Dynamic backdrop glow circles for rich premium aesthetics */}
      <div className="absolute top-[20%] left-[10%] w-[350px] h-[350px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none animate-pulse-slow"></div>
      <div className="absolute bottom-[20%] right-[10%] w-[450px] h-[450px] bg-purple-600/10 rounded-full blur-[140px] pointer-events-none animate-pulse-slow" style={{ animationDelay: '3s' }}></div>
      
      {/* Top thin status border line */}
      <div className="h-[2px] w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>
      
      {/* Render Main Dashboard */}
      <Dashboard />
    </div>
  );
}

export default App;

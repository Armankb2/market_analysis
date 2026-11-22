
import React, { useEffect, useState } from "react";
import Chatbot from "./components/Chatbot";
import MarketDashboard from "./components/MarketDashboard";

function App() {
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === "dark" ? "light" : "dark");
  };

  return (
    <div className="app-container">
      <div className="dashboard-section">
        <MarketDashboard />
      </div>

      <Chatbot theme={theme} toggleTheme={toggleTheme} />
    </div>
  );
}

export default App;

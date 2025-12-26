import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import SessionPage from './SessionPage';
import CollaborativeSession from './CollaborativeSession';
import CollaborativeSessionStepFlow from './CollaborativeSessionStepFlow';
import { useVariant, VARIANTS } from './variants';

// Wrapper que decide qué versión de CollaborativeSession mostrar
function CollaborativeSessionRouter() {
  const variant = useVariant();

  if (variant === VARIANTS.B) {
    return <CollaborativeSessionStepFlow />;
  }

  // Default: variante A (estable, sin 3 pasos)
  return <CollaborativeSession />;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/s/:id" element={<CollaborativeSessionRouter />} />
        <Route path="/session/:id" element={<SessionPage />} />
        <Route path="/" element={<div>Bill-e - Dividir cuentas fácilmente</div>} />
      </Routes>
    </Router>
  );
}

export default App;

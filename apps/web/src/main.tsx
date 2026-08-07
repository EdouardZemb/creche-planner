import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installerRemonteeErreurs } from './api/signalerErreur';
import './styles.css';

const element = document.getElementById('root');
if (!element) {
  throw new Error('Élément racine #root introuvable');
}

// C7 : les deux sources d'erreur qu'aucune frontière React ne voit — exceptions
// hors rendu (gestionnaires d'événements, minuteurs) et promesses rejetées sans
// `catch`. Branché AVANT le montage pour couvrir le premier rendu lui-même.
installerRemonteeErreurs();

createRoot(element).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

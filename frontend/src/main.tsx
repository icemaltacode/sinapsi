import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import './amplifyConfig.ts';

createRoot(document.getElementById('root')!).render(
  <App />
);

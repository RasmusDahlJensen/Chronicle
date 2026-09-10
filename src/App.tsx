import LegacyTerrainLab from './components/LegacyTerrainLab.tsx';
import { RegionalAtlas } from './components/RegionalAtlas.tsx';
import { GeneratedWorldLab } from './components/GeneratedWorldLab.tsx';

export default function App() {
  const scenario = new URLSearchParams(window.location.search).get('scenario');
  if (scenario === 'aster') return <LegacyTerrainLab />;
  if (scenario === 'verdant') return <RegionalAtlas />;
  return <GeneratedWorldLab />;
}

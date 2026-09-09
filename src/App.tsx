import LegacyTerrainLab from './components/LegacyTerrainLab.tsx';
import { RegionalAtlas } from './components/RegionalAtlas.tsx';

export default function App() {
  return new URLSearchParams(window.location.search).get('scenario') === 'aster'
    ? <LegacyTerrainLab /> : <RegionalAtlas />;
}

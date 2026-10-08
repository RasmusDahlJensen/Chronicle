import { GeneratedWorldLab } from './components/GeneratedWorldLab.tsx';
import { Game } from './game/Game.tsx';

/** The game is the main page (milestone U); the developer lab, with geography layers and testing tools, is `?lab`. */
export default function App() {
  return new URLSearchParams(window.location.search).has('lab') ? <GeneratedWorldLab /> : <Game />;
}

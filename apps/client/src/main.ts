import './themes/theme.js';
import './styles/app.css';
import './ui/ui.css';
import { Game } from './app.js';

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const ui = document.querySelector<HTMLDivElement>('#ui')!;
new Game(canvas, ui);

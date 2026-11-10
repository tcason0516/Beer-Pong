import { Game } from './game.js';

const game = new Game();
window.__game = game;
import * as THREE from 'three';
window.__THREE = THREE;
game.boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('loadText');
  if (el) el.textContent = 'Something went wrong: ' + (e && e.message ? e.message : e);
});

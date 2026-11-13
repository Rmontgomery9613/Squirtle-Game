'use strict';
const INTERVAL_SECONDS = 0.5;
const BEEP_DURATION_SECONDS = 0.012;
const BEEP_FREQUENCY_HZ = 880;
const AFTER_FIFTH_MS = 800;
const $ = (id) => document.getElementById(id);
const lights = [...document.querySelectorAll('.light')];
const startButton = $('start');
const offsetInput = $('offset');
let context = null;
let active = false;
let trialId = 0;
let fifthAt = 0;
let firstAt = 0;
let pressedAt = null;
let currentOffset = 0;
let timeouts = [];
let nodes = [];
let keyHeld = false;
let waitingForRelease = false;

function setText(id, text) { $(id).textContent = text; }
function signed(n) { return `${n >= 0 ? '+' : ''}${n.toFixed(1)}`; }
function later(fn, delay) { const id = setTimeout(fn, Math.max(0, delay)); timeouts.push(id); }
function clearTimers() { for (const id of timeouts) clearTimeout(id); timeouts = []; }
function stopAudio() { for (const osc of nodes) { try { osc.stop(); } catch (_) {} } nodes = []; }
function audioNowAsPerfMs(audioTime) {
  // AudioContext and performance.now() have different time origins.
  // getOutputTimestamp() maps the audio context clock to the performance clock.
  if (typeof context.getOutputTimestamp === 'function') {
    const t = context.getOutputTimestamp();
    if (Number.isFinite(t.contextTime) && Number.isFinite(t.performanceTime) && t.performanceTime > 0) {
      return t.performanceTime + (audioTime - t.contextTime) * 1000;
    }
  }
  return performance.now() + (audioTime - context.currentTime) * 1000;
}
function resetDisplay() {
  $('result').className = 'result'; $('message').className = 'message';
  setText('result', 'Listen...'); setText('detail', 'Press A at the START of beep 5'); setText('message', '');
  lights.forEach(el => el.classList.remove('on'));
}
function showResult(deltaMs) {
  if (deltaMs === null) {
    setText('result', 'Missed'); $('result').className = 'result bad';
    setText('detail', 'No A press detected. Click Start Test to retry.');
    setText('message', 'You missed the squirtle, you must be Genlife.');
    $('message').className = 'message bad';
    return;
  }
  const adjusted = deltaMs + currentOffset;
  const label = Math.abs(adjusted) < 0.05 ? 'On target' : adjusted < 0 ? 'Early' : 'Late';
  const won = adjusted >= -8 && adjusted <= 8;
  setText('result', `${signed(adjusted)} ms`);
  $('result').className = `result ${won ? 'good' : 'bad'}`;
  setText('detail', `${label} | Raw: ${signed(deltaMs)} ms | Offset: ${signed(currentOffset)} ms`);
  setText('message', won ? "You got the squirtle, you're better than Genlife." : 'You missed the squirtle, you must be Genlife.');
  $('message').className = `message ${won ? 'good' : 'bad'}`;
}
function completeTrial() {
  if (!active) return;
  active = false;
  clearTimers();
  startButton.disabled = false;
  offsetInput.disabled = false;
  if (pressedAt === null) showResult(null);
}
async function start() {
  if (active) return;
  const offset = Number(offsetInput.value.trim());
  if (offsetInput.value.trim() === '' || !Number.isFinite(offset)) {
    setText('result', 'Invalid offset'); $('result').className = 'result bad';
    setText('detail', 'Enter a number, such as -25, 0, or +15.5'); offsetInput.focus(); return;
  }
  try {
    if (!context) context = new (window.AudioContext || window.webkitAudioContext)({latencyHint:'interactive'});
    await context.resume();
    if (context.state !== 'running') throw new Error('Audio could not start');
  } catch (err) {
    setText('result', 'Audio unavailable'); $('result').className = 'result bad';
    setText('detail', 'Enable sound and click Start Test again.'); return;
  }
  clearTimers(); stopAudio();
  currentOffset = offset;
  active = true;
  const id = ++trialId;
  pressedAt = null;
  waitingForRelease = keyHeld;
  startButton.disabled = true; offsetInput.disabled = true;
  resetDisplay();
  // Start after a short lead-in so the keyboard listener is already ready.
  const firstAudioTime = context.currentTime + 0.20;
  firstAt = audioNowAsPerfMs(firstAudioTime);
  fifthAt = firstAt + 4 * INTERVAL_SECONDS * 1000;
  for (let i = 0; i < 5; i++) {
    const at = firstAudioTime + i * INTERVAL_SECONDS;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine'; osc.frequency.value = BEEP_FREQUENCY_HZ;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(0.28, at + 0.0016);
    gain.gain.setValueAtTime(0.28, at + BEEP_DURATION_SECONDS - 0.002);
    gain.gain.linearRampToValueAtTime(0.0001, at + BEEP_DURATION_SECONDS);
    osc.connect(gain); gain.connect(context.destination);
    osc.start(at); osc.stop(at + BEEP_DURATION_SECONDS + 0.001);
    nodes.push(osc);
    later(() => { if (trialId === id) lights[i].classList.add('on'); }, firstAt + i * 500 - performance.now());
  }
  later(() => { if (active && trialId === id) completeTrial(); }, fifthAt + AFTER_FIFTH_MS - performance.now());
}
startButton.addEventListener('click', start);
document.addEventListener('keydown', (event) => {
  if (event.code !== 'KeyA' || event.repeat) return;
  if (event.target instanceof HTMLElement && (event.target.matches('input,textarea,select') || event.target.isContentEditable)) return;
  if (keyHeld) return;
  keyHeld = true;
  if (!active || waitingForRelease || pressedAt !== null) return;
  // Event timestamp is more accurate than the moment this handler executes.
  let stamp = event.timeStamp;
  if (!Number.isFinite(stamp) || Math.abs(stamp - performance.now()) > 10000) stamp = performance.now();
  if (stamp < firstAt) return;
  pressedAt = stamp;
  // Show the result immediately for early AND late presses.
  // Already-scheduled audio continues so the five-beep sequence stays intact.
  showResult(pressedAt - fifthAt);
});
document.addEventListener('keyup', (event) => {
  if (event.code === 'KeyA') { keyHeld = false; waitingForRelease = false; }
});
window.addEventListener('blur', () => { keyHeld = false; waitingForRelease = false; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && active) {
    active = false; ++trialId; clearTimers(); stopAudio();
    startButton.disabled = false; offsetInput.disabled = false;
    setText('result', 'Paused'); $('result').className = 'result bad';
    setText('detail', 'Tab lost focus. Click Start Test to retry.'); setText('message', '');
  }
});

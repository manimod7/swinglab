export function hardwareHtml() {
  return `
<p>SwingLab runs on a bat that was designed for it: a parametric attachment that turns a Meta Quest 3 Touch Plus controller into a full-size cricket bat you can swing at speed. It was designed and 3D printed by Manish Modwani.</p>
<h2>Specifications</h2>
<ul>
  <li><b>Controller:</b> Meta Quest 3 Touch Plus, mounted on the bat; the second controller stays free for menus.</li>
  <li><b>Parts:</b> five printable files: blade, handle, weight lid, a one-piece version, and a fit-test cradle for checking the controller seat before a full print.</li>
  <li><b>Weight:</b> a toe weight chamber brings the finished bat to roughly 500 to 520 g.</li>
  <li><b>Handle:</b> sized for a standard senior grip, about 93 mm in circumference.</li>
  <li><b>Joint:</b> M4 screws into heat-set inserts, plus dual velcro windows to hold the controller.</li>
  <li><b>Material:</b> PLA, roughly 310 to 420 g of filament depending on the version.</li>
</ul>
<h2>Why the tip offset must be measured</h2>
<p>The headset tracks the controller, not the blade. The blade tip sits at a fixed offset in the controller's own frame, and every metric depends on it. SwingLab finds that offset with a pivot calibration: rest the toe on one spot and swirl the handle. Every sample then satisfies <code>R·t + p = w</code>, where <code>R</code> and <code>p</code> are the controller's rotation and position, <code>t</code> is the unknown tip offset and <code>w</code> is the fixed floor point. That is a linear least-squares problem with six unknowns, solved in a few milliseconds. The residual in millimetres tells you whether the toe slid.</p>
<p>A second step has you hold your stance with the blade facing the bowler. That fixes which way the blade face points, so the app knows the face normal at every moment of the swing.</p>`;
}

export function aboutHtml() {
  return `
<p>SwingLab turns the controller pose that a Meta Quest 3 reports every frame into swing metrics and a shot rating, against a virtual bowling machine.</p>
<h2>What it measures</h2>
<ul>
  <li><b>Peak bat-tip speed</b>, from frame-to-frame tip movement.</li>
  <li><b>Swing plane tilt</b> and how far the tip strays from that plane, fitted to the downswing.</li>
  <li><b>Swing path</b>: the direction of the bat through the hitting zone, left or right of the line to the bowler.</li>
  <li><b>Backlift height</b>: the highest the tip gets before the downswing.</li>
  <li><b>Timing</b>: when the tip crosses the hitting plane compared with the ball, in milliseconds early or late.</li>
  <li><b>Repeatability</b>: how tightly those numbers cluster across a set of ten balls.</li>
</ul>
<h2>The shot rating</h2>
<p>Each ball that touches the bat gets a score from 0 to 100: <b>45% contact quality</b> (how close to the sweet spot, and how central across the blade), <b>30% power</b> (exit speed against 38 m/s), and <b>25% control</b> (direction within about 40 degrees of straight, and kept low). Labels follow the score and the contact point: Middled, Solid, Scratchy, Mistimed, Off the toe, High on the bat, Edged. The formula is in the open and the weights are a judgement, not a law of cricket.</p>
<h2>The drill</h2>
<p>A bowling machine releases a ball every few seconds at 65, 75 or 85 km/h, on a slightly different line and height each time. Ball physics is deliberately simple: gravity, one bounce, no spin or swing. Contact is tested continuously between frames, because a ball at this speed moves about 25 cm per frame. After contact the ball leaves along the blade-face normal, or deflects sideways near the edge, scaled by how well it was struck.</p>
<h2>Limits, stated up front</h2>
<ul>
  <li>Headset tracking is good but is not a laboratory instrument. At 72 Hz a sampled peak speed reads a few percent under the true instantaneous peak.</li>
  <li>The ball is virtual; no real ball is tracked.</li>
  <li>SwingLab is its own scene. The Quest runs one immersive app at a time, and iB Cricket does not export swing data, so the two cannot run together.</li>
  <li>The simulator and the sample session use synthetic swings from a scripted batter and are labelled that way. They show the pipeline working; they are not recordings of a person.</li>
  <li>Headset mode needs the Meta Quest Browser and a secure (HTTPS) page.</li>
</ul>
<h2>Privacy</h2>
<p>Everything runs in your browser. Sessions are stored in this browser's local storage and leave only if you press Download.</p>`;
}
